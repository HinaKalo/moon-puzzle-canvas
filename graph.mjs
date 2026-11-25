export const kinds = {
  start: ["起点", "#23614e", "#d8f3e7"],
  scene: ["场景", "#365683", "#e3edff"],
  clue: ["线索", "#85570c", "#fff0bc"],
  item: ["道具", "#784970", "#fce4f4"],
  lock: ["机关", "#a24737", "#ffe2d6"],
  choice: ["选择", "#5c4aa0", "#eee6ff"],
  end: ["结局", "#176574", "#d3f4f8"],
};

const night = "#172d2c";
const templates = {
  puzzle: {
    nodes: [
      { id: "entrance", kind: "start", label: "进入旧档案馆" },
      { id: "note", kind: "clue", label: "读到值班记录" },
      { id: "key", kind: "item", label: "找到发条钥匙" },
      { id: "safe", kind: "lock", label: "打开机械保险柜", mode: "all" },
      { id: "escape", kind: "end", label: "带走失踪案卷宗" },
    ],
    links: [
      { from: "entrance", to: "note" }, { from: "entrance", to: "key" },
      { from: "note", to: "safe" }, { from: "key", to: "safe" }, { from: "safe", to: "escape" },
    ],
  },
  story: {
    nodes: [
      { id: "docks", kind: "start", label: "到达夜间码头" },
      { id: "witness", kind: "scene", label: "听完目击者证词" },
      { id: "decision", kind: "choice", label: "如何处置证词？" },
      { id: "protect", kind: "end", label: "保护目击者" },
      { id: "publish", kind: "end", label: "公开调查记录" },
    ],
    links: [
      { from: "docks", to: "witness" }, { from: "witness", to: "decision" },
      { from: "decision", to: "protect", label: "封存" }, { from: "decision", to: "publish", label: "公开" },
    ],
  },
  blank: { nodes: [], links: [] },
};

function base(type, id, x, y, width, height, strokeColor, backgroundColor = "transparent") {
  return {
    id, type, x, y, width, height, angle: 0, strokeColor, backgroundColor,
    fillStyle: "solid", strokeWidth: 2, strokeStyle: "solid", roughness: 0, opacity: 100,
    groupIds: [], frameId: null, roundness: null, seed: 1,
    version: 1, versionNonce: 0, isDeleted: false, boundElements: null,
    updated: Date.now(), link: null, locked: false,
  };
}

function caption(id, containerId, label, x, y, fontSize, width) {
  const lines = label.split("\n");
  return {
    ...base("text", id, x, y, width, lines.length * fontSize * 1.25, night),
    fontSize, fontFamily: 2, text: label, originalText: label,
    textAlign: "center", verticalAlign: "middle", containerId, autoResize: true, lineHeight: 1.25,
  };
}

export function nodeElements({ id, kind, label, mode = "all" }, x, y) {
  const [, stroke, fill] = kinds[kind];
  const width = Math.max(166, Math.min(340, [...label].length * 17 + 30));
  const height = 68;
  const text = caption(`text-${id}`, id, label, x + 12, y + 24, 17, width - 24);
  const shape = {
    ...base("rectangle", id, x, y, width, height, stroke, fill),
    roundness: { type: 3, value: 10 },
    customData: { puzzle: { kind, mode } }, boundElements: [{ id: text.id, type: "text" }],
  };
  return [shape, text];
}

export function addLink(elements, { from, to, label }) {
  const src = elements.find((element) => element.id === from && !element.isDeleted);
  const dst = elements.find((element) => element.id === to && !element.isDeleted);
  if (!src || !dst || from === to) throw new Error("依赖线需要两个不同的节点");
  if (elements.some((element) => !element.isDeleted && element.type === "arrow"
    && element.startBinding?.elementId === from && element.endBinding?.elementId === to)) {
    throw new Error("这条依赖线已存在");
  }
  const id = `arrow-${crypto.randomUUID()}`;
  const srcRight = (src.x + src.width / 2) <= (dst.x + dst.width / 2);
  const nearlyAligned = Math.abs((src.x + src.width / 2) - (dst.x + dst.width / 2)) < 36;
  const srcAbove = src.y < dst.y;
  const start = nearlyAligned ? [0.5, srcAbove ? 1 : 0] : [srcRight ? 1 : 0, 0.5];
  const end = nearlyAligned ? [0.5, srcAbove ? 0 : 1] : [srcRight ? 0 : 1, 0.5];
  const margin = 5;
  const x = src.x + src.width * start[0] + (start[0] - 0.5) * margin * 2;
  const y = src.y + src.height * start[1] + (start[1] - 0.5) * margin * 2;
  const dx = dst.x + dst.width * end[0] + (end[0] - 0.5) * margin * 2 - x;
  const dy = dst.y + dst.height * end[1] + (end[1] - 0.5) * margin * 2 - y;
  const arrow = {
    ...base("arrow", id, x, y, Math.abs(dx), Math.abs(dy), "#52706e"),
    points: [[0, 0], [dx, dy]], lastCommittedPoint: null, elbowed: false,
    startBinding: { elementId: from, fixedPoint: start, focus: 0, gap: margin },
    endBinding: { elementId: to, fixedPoint: end, focus: 0, gap: margin },
    startArrowhead: null, endArrowhead: "arrow",
  };
  const result = elements.map((element) => element === src || element === dst
    ? revise(element, { boundElements: [...(element.boundElements || []), { id, type: "arrow" }] })
    : element);
  if (!label) return [...result, arrow];
  const text = caption(`text-${id}`, id, label, x + dx / 2, y + dy / 2, 14, Math.max(30, label.length * 14));
  arrow.boundElements = [{ id: text.id, type: "text" }];
  return [...result, arrow, text];
}

export function revise(element, patch) {
  return {
    ...element, ...patch,
    updated: Date.now(), version: element.version + 1, versionNonce: Math.floor(Math.random() * 2 ** 31),
  };
}

export function extractGraph(elements) {
  const active = elements.filter((element) => !element.isDeleted);
  const labels = new Map(active.filter((element) => element.type === "text" && element.containerId)
    .map((element) => [element.containerId, element.originalText ?? element.text]));
  const nodes = active.filter((element) => Object.hasOwn(kinds, element.customData?.puzzle?.kind))
    .map((element) => ({
      id: element.id, kind: element.customData.puzzle.kind,
      label: labels.get(element.id) || kinds[element.customData.puzzle.kind][0],
      mode: element.customData.puzzle.mode === "any" ? "any" : "all",
    }));
  const ids = new Set(nodes.map(({ id }) => id));
  const links = active.filter((element) => element.type === "arrow"
    && ids.has(element.startBinding?.elementId) && ids.has(element.endBinding?.elementId))
    .map((element) => ({
      id: element.id, from: element.startBinding.elementId, to: element.endBinding.elementId,
      ...(labels.get(element.id) ? { label: labels.get(element.id) } : {}),
    }));
  return { nodes, links };
}

export function appendGraph(elements, nodes, links) {
  const ids = new Set(elements.map(({ id }) => id));
  const nodeIds = new Set(extractGraph(elements).nodes.map(({ id }) => id));
  const fresh = new Set(nodes.map(({ id }) => id));
  for (const { id } of nodes) {
    if (ids.has(id) || ids.has(`text-${id}`) || fresh.has(`text-${id}`)) throw new Error(`元素 ID 已占用：${id}`);
    ids.add(id);
    nodeIds.add(id);
  }
  for (const { from, to } of links) {
    if (!nodeIds.has(from) || !nodeIds.has(to)) throw new Error(`依赖端点不存在：${from} → ${to}`);
  }
  const levels = new Map();
  const dependencies = new Map(nodes.map(({ id }) => [id, []]));
  for (const { from, to } of links) {
    if (fresh.has(from) && fresh.has(to)) dependencies.get(to).push(from);
  }
  let waiting = nodes.slice();
  while (waiting.length) {
    const ready = waiting.filter(({ id }) => dependencies.get(id).every((from) => levels.has(from)));
    if (!ready.length) break;
    for (const { id } of ready) levels.set(id, Math.max(-1, ...dependencies.get(id).map((from) => levels.get(from))) + 1);
    waiting = waiting.filter(({ id }) => !levels.has(id));
  }
  const fallback = Math.max(-1, ...levels.values()) + 1;
  const origin = elements.reduce((right, element) => element.isDeleted ? right : Math.max(right, element.x + element.width + 130), 60);
  const lanes = new Map();
  const added = nodes.flatMap((node) => {
    const column = levels.get(node.id) ?? fallback;
    const lane = lanes.get(column) ?? 0;
    lanes.set(column, lane + 1);
    return nodeElements(node, origin + column * 400, 100 + lane * 140);
  });
  return links.reduce(addLink, [...elements, ...added]);
}

export function makeScene(template) {
  const graph = templates[template];
  if (!graph) throw new Error("未知模板");
  return {
    type: "excalidraw", version: 2, source: "moon-puzzle-canvas",
    elements: appendGraph([], graph.nodes, graph.links),
    appState: { viewBackgroundColor: "#f8faf8", gridSize: 20, gridStep: 5, gridModeEnabled: true },
    files: {},
  };
}

export function analyzeGraph({ nodes, links }) {
  const incoming = new Map(nodes.map(({ id }) => [id, []]));
  const outgoing = new Map(nodes.map(({ id }) => [id, []]));
  for (const { from, to } of links) {
    incoming.get(to).push(from);
    outgoing.get(from).push(to);
  }
  const starts = nodes.filter(({ kind }) => kind === "start").map(({ id }) => id);
  const ends = nodes.filter(({ kind }) => kind === "end").map(({ id }) => id);
  const reached = new Set(starts);
  const satisfied = new Map();
  const any = new Set(nodes.filter(({ mode }) => mode === "any").map(({ id }) => id));
  for (const id of reached) {
    for (const target of outgoing.get(id)) {
      if (reached.has(target)) continue;
      const count = (satisfied.get(target) || 0) + 1;
      satisfied.set(target, count);
      if (any.has(target) || count === incoming.get(target).length) reached.add(target);
    }
  }
  const reachableEnds = ends.filter((id) => reached.has(id));
  const canFinish = new Set(reachableEnds);
  for (const id of canFinish) {
    for (const from of incoming.get(id)) {
      if (reached.has(from)) canFinish.add(from);
    }
  }

  // Peel off acyclic sources and sinks. An edge between two surviving
  // cycles can stay in the core too, so report the core as candidates.
  const remaining = new Set(outgoing.keys());
  const inDegree = new Map([...incoming].map(([id, inputs]) => [id, inputs.length]));
  const outDegree = new Map([...outgoing].map(([id, outputs]) => [id, outputs.length]));
  const peel = new Set(nodes.map(({ id }) => id).filter((id) => !inDegree.get(id) || !outDegree.get(id)));
  for (const id of peel) {
    remaining.delete(id);
    for (const target of outgoing.get(id)) {
      inDegree.set(target, inDegree.get(target) - 1);
      if (!inDegree.get(target)) peel.add(target);
    }
    for (const source of incoming.get(id)) {
      outDegree.set(source, outDegree.get(source) - 1);
      if (!outDegree.get(source)) peel.add(source);
    }
  }
  return {
    starts, ends, reachableEnds,
    unreachable: nodes.filter(({ id }) => !reached.has(id)).map(({ id }) => id),
    noEndingPath: [...reached].filter((id) => !canFinish.has(id)),
    cycleCandidates: [...remaining],
  };
}
