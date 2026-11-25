import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  CaptureUpdateAction, Excalidraw, loadFromBlob, serializeAsJSON, viewportCoordsToSceneCoords,
} from "@excalidraw/excalidraw";
import "@excalidraw/excalidraw/index.css";
import { addLink, analyzeGraph, extractGraph, kinds, nodeElements, revise } from "./graph.mjs";
import "./style.css";

const noGraph = { nodes: [], links: [] };
const templateNames = { blank: "空白画板", puzzle: "谜题依赖图", story: "分支剧情图" };
const editorOptions = {
  canvasActions: {
    loadScene: false, saveToActiveFile: false, export: false, saveAsImage: true,
  },
};

async function request(path, options) {
  const response = await fetch(`/api/boards${path}`, {
    ...options,
    ...(options?.body ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(options.body) } : {}),
  });
  const body = await response.json();
  if (response.status === 401) throw new Error("请在新标签页重新登录画板后重试。当前改动还在。");
  if (!response.ok) throw new Error(body.error);
  return body;
}

function signature(elements, state, files) {
  return JSON.stringify([
    state.viewBackgroundColor, state.gridModeEnabled, state.gridSize,
    elements.map(({ id, version, versionNonce, isDeleted }) => [id, version, versionNonce, isDeleted]),
    Object.keys(files).sort(),
  ]);
}

function Analysis({ graph, focus }) {
  if (!graph.nodes.length) return <p className="hint">放入起点、结局和其他节点，再用箭头连接。</p>;
  const report = analyzeGraph(graph);
  const labels = new Map(graph.nodes.map(({ id, label }) => [id, label]));
  const groups = [
    ["不可达", report.unreachable],
    ["无法通向结局", report.noEndingPath],
    ["循环依赖候选", report.cycleCandidates],
  ];
  return <>
    <dl className="stats">
      <div><dt>起点</dt><dd>{report.starts.length}</dd></div>
      <div><dt>可达结局</dt><dd>{report.reachableEnds.length}<small> / {report.ends.length}</small></dd></div>
    </dl>
    {!report.starts.length && <p className="warning">缺少起点。</p>}
    {!report.ends.length && <p className="warning">缺少结局。</p>}
    {report.ends.length > 0 && report.reachableEnds.length === 0 && <p className="warning">没有可达结局。</p>}
    {groups.map(([name, ids]) => <div key={name} className="finding">
      <strong>{name}<span>{ids.length}</span></strong>
      {ids.length > 0 && <ul>{ids.map((id) =>
        <li key={id}><button onClick={() => focus(id)}>{labels.get(id)}</button></li>)}</ul>}
    </div>)}
    <p className="hint">静态检查使用节点的全部或任一前置条件。运行时变量、互斥选择和道具消耗需在游戏内验证。</p>
  </>;
}

function Inspector({ node, graph, setMode, connect }) {
  const [target, setTarget] = useState("");
  const [label, setLabel] = useState("");
  const alreadyLinked = new Set(graph.links.filter(({ from }) => from === node.id).map(({ to }) => to));
  const targets = graph.nodes.filter(({ id }) => id !== node.id && !alreadyLinked.has(id));
  return <div className="inspector">
    <span className="node-kind" style={{ "--node-ink": kinds[node.kind][1], "--node-fill": kinds[node.kind][2] }}>{kinds[node.kind][0]}</span>
    <h3>{node.label}</h3>
    {node.kind !== "start" && <label>前置条件
      <select value={node.mode} onChange={(event) => setMode(node.id, event.target.value)}>
        <option value="all">满足全部前置（AND）</option>
        <option value="any">满足任一前置（OR）</option>
      </select>
    </label>}
    <form onSubmit={(event) => {
      event.preventDefault();
      if (connect({ from: node.id, to: target, label: label.trim() })) {
        setTarget("");
        setLabel("");
      }
    }}>
      <label>连接到
        <select value={target} onChange={(event) => setTarget(event.target.value)} required>
          <option value="">选择下游节点</option>
          {targets.map(({ id, label }) => <option key={id} value={id}>{label}</option>)}
        </select>
      </label>
      {target && <label>箭头文字<input value={label} maxLength={40} onChange={(event) => setLabel(event.target.value)} placeholder="可选，如「交出钥匙」" /></label>}
      <button className="secondary stretch" disabled={!target}>连接节点</button>
    </form>
  </div>;
}

function App() {
  const [boards, setBoards] = useState([]);
  const [board, setBoard] = useState(null);
  const [name, setName] = useState("");
  const [epoch, setEpoch] = useState(0);
  const [api, setApi] = useState(null);
  const [graph, setGraph] = useState(noGraph);
  const [selection, setSelection] = useState("");
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [analysis, setAnalysis] = useState(false);
  const [newBoard, setNewBoard] = useState(false);
  const [newName, setNewName] = useState("");
  const [template, setTemplate] = useState("puzzle");
  const [mobileTools, setMobileTools] = useState(false);
  const canvas = useRef(null);
  const editor = useRef(null);
  const fitOnLoad = useRef(false);
  const importInput = useRef(null);
  const saved = useRef(null);
  const current = useRef(null);
  const nameRef = useRef("");
  const savedName = useRef("");
  const makingRequest = useRef(false);
  const dirtyRef = useRef(false);

  function checkDirty() {
    const changed = saved.current !== current.current || savedName.current !== nameRef.current;
    dirtyRef.current = changed;
    setDirty(changed);
  }

  function rename(value) {
    nameRef.current = value;
    setName(value);
    checkDirty();
  }

  function open(next) {
    saved.current = null;
    current.current = null;
    savedName.current = next.title;
    rename(next.title);
    setGraph(extractGraph(next.scene.elements));
    setSelection("");
    setBoard(next);
    fitOnLoad.current = true;
    editor.current = null;
    setApi(null);
    setEpoch((value) => value + 1);
    window.history.replaceState(null, "", `/?board=${next.id}`);
  }

  async function perform(action) {
    if (makingRequest.current) return;
    makingRequest.current = true;
    setBusy(true);
    setError("");
    setStatus("");
    try {
      await action();
    } catch (failure) {
      setError(failure.message || "操作失败");
    } finally {
      makingRequest.current = false;
      setBusy(false);
    }
  }

  const mayLeave = () => !dirtyRef.current || window.confirm("画板有未保存的改动。确定离开当前版本？");

  function refresh(id, newest = false) {
    if (!mayLeave()) return;
    void perform(async () => {
      const available = await request("");
      setBoards(available);
      const requested = newest
        ? (available.some((entry) => entry.id === id) ? id : available[0]?.id)
        : id;
      if (requested) open(await request(`/${requested}`));
    });
  }

  useEffect(() => {
    refresh(new URLSearchParams(window.location.search).get("board"), true);
    const guard = (event) => {
      if (dirtyRef.current) event.preventDefault();
    };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, []);

  function onChange(elements, state, files) {
    if (fitOnLoad.current && editor.current && elements.some((element) => !element.isDeleted)) {
      const active = editor.current;
      fitOnLoad.current = false;
      window.requestAnimationFrame(() => {
        if (editor.current === active) active.scrollToContent(undefined, {
          fitToViewport: true, viewportZoomFactor: 0.86, maxZoom: 1,
        });
      });
    }
    const value = signature(elements, state, files);
    if (saved.current === null) saved.current = value;
    if (current.current !== value) {
      current.current = value;
      setGraph(extractGraph(elements));
      checkDirty();
    }
    const ids = Object.keys(state.selectedElementIds).filter((id) => state.selectedElementIds[id]);
    setSelection(ids.length === 1 ? ids[0] : "");
  }

  function save() {
    if (!api || !board) return;
    void perform(async () => {
      const title = nameRef.current.trim();
      if (!title) throw new Error("请输入画板名称");
      const elements = api.getSceneElements();
      const state = api.getAppState();
      const files = api.getFiles();
      const afterSave = signature(api.getSceneElementsIncludingDeleted(), state, files);
      const scene = JSON.parse(serializeAsJSON(elements, state, files, "local"));
      scene.source = "moon-puzzle-canvas";
      scene.appState.gridModeEnabled = state.gridModeEnabled;
      const next = await request(`/${board.id}`, { method: "PUT", body: { title, revision: board.revision, scene } });
      saved.current = afterSave;
      savedName.current = title;
      if (nameRef.current.trim() === title) rename(title);
      setBoard(next);
      setBoards((list) => list.map((entry) => entry.id === next.id ? { ...entry, title } : entry));
      checkDirty();
      setStatus(`已保存到 Moon · v${next.revision}`);
    });
  }

  function create(event) {
    event.preventDefault();
    if (!mayLeave()) return;
    void perform(async () => {
      const next = await request("", { method: "POST", body: { title: newName.trim(), template } });
      setBoards((list) => [next, ...list]);
      open(next);
      setNewBoard(false);
      setNewName("");
    });
  }

  function exportScene() {
    const scene = JSON.parse(serializeAsJSON(api.getSceneElements(), api.getAppState(), api.getFiles(), "local"));
    scene.source = "moon-puzzle-canvas";
    const url = URL.createObjectURL(new Blob([JSON.stringify(scene, null, 2) + "\n"], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `${name.trim() || "Moon 画板"}.excalidraw`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    setStatus("已导出可编辑画板");
  }

  function importScene(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !mayLeave()) return;
    void perform(async () => {
      if (file.size > 24 * 1024 * 1024) throw new Error("文件超过 24 MB");
      const scene = await loadFromBlob(file, null, null);
      if (!window.confirm("导入会替换当前画布内容。保存前可重新加载服务器版本。继续导入？")) return;
      api.addFiles(Object.values(scene.files));
      api.updateScene({ elements: scene.elements,
        appState: { viewBackgroundColor: scene.appState.viewBackgroundColor, selectedElementIds: {} },
        captureUpdate: CaptureUpdateAction.IMMEDIATELY });
      api.scrollToContent(scene.elements, { fitToContent: true });
      setStatus("画板已导入，请保存到 Moon");
    });
  }

  function insert(kind) {
    if (!api) return;
    const elements = api.getSceneElementsIncludingDeleted();
    const rect = canvas.current.getBoundingClientRect();
    const view = api.getAppState();
    const { x, y } = viewportCoordsToSceneCoords({ clientX: rect.left + rect.width / 2,
      clientY: rect.top + rect.height * 0.72 }, view);
    const id = `node-${crypto.randomUUID()}`;
    const node = { id, kind, label: kinds[kind][0], mode: kind === "end" ? "any" : "all" };
    const left = Math.round(x - 85);
    let top = Math.round(y - 34);
    const occupied = elements.filter((element) => !element.isDeleted && element.customData?.puzzle);
    for (let index = 0; index <= occupied.length; index++) {
      const overlap = occupied.find((element) => left < element.x + element.width + 14
        && left + 180 > element.x && top < element.y + element.height + 14 && top + 82 > element.y);
      if (!overlap) break;
      top = Math.ceil(overlap.y + overlap.height + 14);
    }
    const added = nodeElements(node, left, top);
    api.updateScene({ elements: [...elements, ...added], appState: { selectedElementIds: { [id]: true } },
      captureUpdate: CaptureUpdateAction.IMMEDIATELY });
    api.setActiveTool({ type: "selection" });
    if (top !== Math.round(y - 34)) api.scrollToContent(added[0]);
    setAnalysis(false);
    setStatus("双击节点可编辑文字");
  }

  function setMode(id, mode) {
    api.updateScene({ elements: api.getSceneElementsIncludingDeleted().map((element) => element.id === id
      ? revise(element, { customData: { ...element.customData, puzzle: { ...element.customData.puzzle, mode } } })
      : element), captureUpdate: CaptureUpdateAction.IMMEDIATELY });
  }

  function connect(link) {
    try {
      api.updateScene({ elements: addLink(api.getSceneElementsIncludingDeleted(), link),
        captureUpdate: CaptureUpdateAction.IMMEDIATELY });
      setError("");
      return true;
    } catch (failure) {
      setError(failure.message);
      return false;
    }
  }

  function focus(id) {
    const target = api.getSceneElements().find((element) => element.id === id);
    if (!target) return;
    api.scrollToContent(target, { animate: true });
    api.updateScene({ appState: { selectedElementIds: { [id]: true } } });
    setMobileTools(false);
  }

  const selected = graph.nodes.find(({ id }) => id === selection);
  return <div className="workspace">
    <header className="masthead">
      <div className="brand"><span className="brand-mark" aria-hidden="true"></span><h1>Moon 剧情画板</h1></div>
      <div className="document">
        <input aria-label="画板名称" maxLength={100} value={name} disabled={!board} onChange={(event) => rename(event.target.value)} />
        {board && <small title="服务器版本">v{board.revision}</small>}
      </div>
      <div className="actions">
        <button className="mobile-toggle quiet" aria-expanded={mobileTools} onClick={() => setMobileTools(!mobileTools)}>工具</button>
        <button className="quiet" onClick={() => refresh(board?.id, true)} disabled={busy}>重新加载</button>
        <button className="quiet" onClick={() => importInput.current.click()} disabled={!api || busy}>导入</button>
        <button className="quiet" onClick={exportScene} disabled={!api}>导出</button>
        <button className="primary" onClick={save} disabled={!api || busy || !dirty}>保存</button>
        {window.location.protocol === "https:" && <form method="post" action="/auth/logout"
          onSubmit={(event) => { if (!mayLeave()) event.preventDefault(); }}>
          <button className="quiet">退出</button>
        </form>}
        <input ref={importInput} type="file" hidden accept=".excalidraw,.json" onChange={importScene} />
      </div>
    </header>
    <div className="surface">
      <aside className="sidebar" data-open={mobileTools}>
        <section>
          <div className="section-title"><h2>画板</h2><button className="quiet" aria-expanded={newBoard} onClick={() => setNewBoard(!newBoard)} disabled={busy}>新建</button></div>
          <select aria-label="选择画板" value={board?.id || ""} disabled={busy} onChange={(event) => refresh(event.target.value)}>
            {!board && <option value="">选择画板</option>}
            {boards.map(({ id, title }) => <option key={id} value={id}>{title}</option>)}
          </select>
          {newBoard && <form className="creation" onSubmit={create}>
            <label>名称<input maxLength={100} value={newName} onChange={(event) => setNewName(event.target.value)} required autoFocus /></label>
            <label>模板<select value={template} onChange={(event) => setTemplate(event.target.value)}>
              {Object.entries(templateNames).map(([id, title]) => <option key={id} value={id}>{title}</option>)}
            </select></label>
            <button className="secondary stretch" disabled={busy || !newName.trim()}>创建画板</button>
          </form>}
        </section>
        <section>
          <div className="section-title"><h2>节点</h2></div>
          <div className="palette">
            {Object.entries(kinds).map(([kind, [title, ink, fill]]) =>
              <button key={kind} disabled={!api} onClick={() => insert(kind)} aria-label={`添加${title}节点`}
                style={{ "--node-ink": ink, "--node-fill": fill }}><span aria-hidden="true"></span>{title}</button>)}
          </div>
          <p className="hint">选中节点后可连接下游。箭头指向依赖该节点的步骤。</p>
        </section>
        <section className="details">
          <div className="section-title"><h2>{analysis ? "依赖检查" : "节点设置"}</h2>
            <button className="quiet" aria-pressed={analysis} disabled={!api} onClick={() => setAnalysis(!analysis)}>
              {analysis ? "返回" : "检查依赖"}
            </button>
          </div>
          {analysis ? <Analysis graph={graph} focus={focus} />
            : selected ? <Inspector key={selected.id} node={selected} graph={graph} setMode={setMode} connect={connect} />
              : <p className="hint">选中分类节点可设置前置条件、添加依赖线。</p>}
        </section>
      </aside>
      <main className="canvas-wrap" ref={canvas} aria-label="Excalidraw 画布">
        {board ? <Excalidraw key={epoch} excalidrawAPI={(instance) => {
          editor.current = instance;
          setApi(instance);
        }} onChange={onChange} initialData={board.scene} UIOptions={editorOptions}
          langCode="zh-CN" theme="light" />
          : <div className="loading">{busy ? "正在打开画板…" : error || "请选择画板"}</div>}
      </main>
    </div>
    <footer className="statusbar">
      <span className={dirty ? "save-state dirty" : "save-state"} aria-live="polite">
        {dirty ? "有未保存改动" : board ? "已与 Moon 同步" : "Moon"}
      </span>
      <span className={error ? "message error" : "message"} role="status">{error || status}</span>
      <span className="count">{graph.nodes.length} 个节点 <span>·</span> {graph.links.length} 条依赖</span>
    </footer>
  </div>;
}

createRoot(document.getElementById("root")).render(<App />);
