import express from "express";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { analyzeGraph, appendGraph, extractGraph, kinds, makeScene } from "./graph.mjs";
import { makeSso } from "./sso.mjs";

const app = express();
const port = Number(process.env.PORT || 18847);
const dataDir = resolve(process.env.BOARD_DIR || "boards");
const staticDir = fileURLToPath(new URL("./dist/", import.meta.url));
const loopbackHost = /^(localhost|127\.0\.0\.1)(:\d+)?$/;
const publicOrigin = process.env.CANVAS_PUBLIC_ORIGIN;
const publicHost = publicOrigin ? new URL(publicOrigin).host : null;
const ssoSettings = {
  origin: publicOrigin,
  issuer: process.env.MOON_SSO_ISSUER,
  clientId: process.env.MOON_SSO_CLIENT_ID,
  secret: process.env.MOON_SSO_CLIENT_SECRET,
};
if (publicOrigin && Object.values(ssoSettings).some((value) => !value)) {
  throw new Error("Canvas public access requires Moon SSO client settings");
}
const sso = publicOrigin ? makeSso(ssoSettings) : null;
const boardId = z.uuid();
const title = z.string().trim().min(1).max(100);
const template = z.enum(["blank", "puzzle", "story"]);
const createInput = z.object({ title, template });
const record = z.record(z.string(), z.unknown());
const sceneInput = z.object({
  type: z.literal("excalidraw"), version: z.literal(2), source: z.string().optional(),
  elements: z.array(record).max(10_000), appState: record, files: record,
});
const saveInput = z.object({ title, scene: sceneInput, revision: z.int().positive() });
const elementId = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/);
const nodeInput = z.object({
  id: elementId,
  kind: z.enum(Object.keys(kinds)).describe("start 起点, scene 场景, clue 线索, item 道具, lock 机关, choice 选择, end 结局"),
  label: z.string().trim().min(1).max(60),
  mode: z.enum(["all", "any"]).default("all").describe("达到节点需满足全部或任一上游节点"),
});
const linkInput = z.object({ from: elementId, to: elementId, label: z.string().trim().max(40).optional() });

app.disable("x-powered-by");
app.use((req, res, next) => {
  const host = req.headers.host || "";
  const isPublic = publicHost !== null && host === publicHost && req.headers["x-forwarded-proto"] === "https";
  const expectedOrigin = isPublic ? publicOrigin : `http://${host}`;
  if ((!isPublic && !loopbackHost.test(host)) || (req.headers.origin && req.headers.origin !== expectedOrigin)) {
    res.status(403).json({ error: "无效的访问来源" });
    return;
  }
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  if (isPublic) return sso(req, res, next);
  next();
});
app.use(["/api", "/mcp"], (req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  if (req.method === "POST" || req.method === "PUT") {
    if (!req.is("application/json")) return res.status(415).json({ error: "请求需要 application/json" });
  }
  next();
}, express.json({ limit: "24mb" }));

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function readBoard(id) {
  if (!boardId.safeParse(id).success) throw new HttpError(404, "画板不存在");
  const path = resolve(dataDir, `${id}.json`);
  if (!existsSync(path)) throw new HttpError(404, "画板不存在");
  return JSON.parse(readFileSync(path, "utf8"));
}

function metadata({ id, title, revision, updatedAt }) {
  return { id, title, revision, updatedAt, path: `/?board=${id}` };
}

function listBoards() {
  return readdirSync(dataDir).filter((name) => boardId.safeParse(name.slice(0, -5)).success && name.endsWith(".json"))
    .map((name) => metadata(readBoard(name.slice(0, -5))))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

function persist(board) {
  const target = resolve(dataDir, `${board.id}.json`);
  writeFileSync(`${target}.tmp`, JSON.stringify(board) + "\n", { flush: true, mode: 0o600 });
  renameSync(`${target}.tmp`, target);
  return board;
}

function createBoard({ title, template }) {
  return persist({
    id: crypto.randomUUID(), title, revision: 1, updatedAt: new Date().toISOString(), scene: makeScene(template),
  });
}

function updateBoard(board, next) {
  if (next.revision !== board.revision) throw new HttpError(409, "画板已有更新。请先导出本地改动，再重新加载。");
  return persist({ ...board, ...next, revision: board.revision + 1, updatedAt: new Date().toISOString() });
}

app.get("/healthz", (_, res) => res.json({ service: "moon-puzzle-canvas", status: "ok" }));
app.get("/api/boards", (_, res) => res.json(listBoards()));
app.post("/api/boards", (req, res) => res.status(201).json(createBoard(createInput.parse(req.body))));
app.get("/api/boards/:id", (req, res) => res.json(readBoard(req.params.id)));
app.put("/api/boards/:id", (req, res) => res.json(updateBoard(readBoard(req.params.id), saveInput.parse(req.body))));
app.use("/api", (_, res) => res.status(404).json({ error: "接口不存在" }));

function result(data) {
  return { content: [{ type: "text", text: JSON.stringify(data) }], structuredContent: data };
}

function mcpTool(server, name, description, inputSchema, readOnlyHint, handler) {
  server.registerTool(name, { description, inputSchema, annotations: { readOnlyHint, destructiveHint: false } }, (input) => {
    try {
      return result(handler(input));
    } catch (error) {
      return { isError: true, content: [{ type: "text", text: error.message }] };
    }
  });
}

function makeMcp() {
  const server = new McpServer({ name: "moon-puzzle-canvas", version: "1.0.0" }, {
    instructions: "Moon Excalidraw 剧情画板。先列出或创建画板，再读图或用 revision 追加图。箭头 A→B 表示 A 是 B 的前置条件；全部/任一指入边的满足方式。检查只模拟静态依赖。",
  });
  mcpTool(server, "list_boards", "列出 Moon 上的共享画板。", {}, true, () => ({ boards: listBoards() }));
  mcpTool(server, "create_board", "创建空白、解谜依赖或剧情分支画板，返回 ID、版本和浏览器路径。",
    createInput.shape, false, (input) => metadata(createBoard(input)));
  mcpTool(server, "get_board", "读取画板标题、版本、类型化节点和依赖。includeScene 可附带原生 Excalidraw 场景。",
    { id: boardId, includeScene: z.boolean().default(false) }, true, ({ id, includeScene }) => {
      const board = readBoard(id);
      return { ...metadata(board), ...extractGraph(board.scene.elements), ...(includeScene ? { scene: board.scene } : {}) };
    });
  mcpTool(server, "append_graph", "向已有画板追加游戏节点和有向依赖，支持连到已有节点。以 get_board 的 revision 防止覆盖并发修改。",
    { id: boardId, revision: z.int().positive(), nodes: z.array(nodeInput).max(100), links: z.array(linkInput).max(250) },
    false, ({ id, revision, nodes, links }) => {
      const board = readBoard(id);
      if (revision !== board.revision) throw new HttpError(409, "画板已有更新，请重新读取 revision");
      if (!nodes.length && !links.length) throw new Error("请至少提供一个节点或依赖");
      const elements = appendGraph(board.scene.elements, nodes, links);
      const scene = sceneInput.parse({ ...board.scene, elements });
      return metadata(updateBoard(board, { scene, revision }));
    });
  mcpTool(server, "inspect_dependencies", "检查起点、可达结局、不可达节点、无法通向结局的可达节点及循环候选。",
    { id: boardId }, true, ({ id }) => {
      const board = readBoard(id);
      const graph = extractGraph(board.scene.elements);
      return { ...metadata(board), ...analyzeGraph(graph) };
    });
  return server;
}

app.post("/mcp", async (req, res) => {
  const server = makeMcp();
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  res.on("close", () => { void server.close().catch(console.error); });
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
});
app.all("/mcp", (_, res) => res.status(405).set("Allow", "POST").end());

app.use(express.static(staticDir, {
  setHeaders: (res, path) => res.setHeader("Cache-Control", /[\\/]assets[\\/]/.test(path) ? "public, max-age=31536000, immutable" : "no-cache"),
}));
app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);
  if (error instanceof z.ZodError) return res.status(400).json({ error: "画板数据不符合格式", issues: error.issues });
  if (error instanceof HttpError || error.status === 400 || error.status === 413) {
    return res.status(error.status).json({ error: error.status === 413 ? "文件超过 24 MB" : error.message });
  }
  console.error(error);
  res.status(500).json({ error: "画板服务错误" });
});

mkdirSync(dataDir, { recursive: true, mode: 0o700 });
if (!listBoards().length) createBoard({ title: "示例 · 旧档案馆", template: "puzzle" });
const httpServer = app.listen(port, process.env.BIND_HOST || "127.0.0.1",
  () => console.log(`Moon puzzle canvas on port ${port}`));
process.once("SIGTERM", () => {
  httpServer.close((error) => {
    if (error) {
      console.error(error);
      process.exitCode = 1;
    }
  });
});
