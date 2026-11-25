import assert from "node:assert/strict";
import { test } from "node:test";
import { makeScene, appendGraph, extractGraph, analyzeGraph } from "./graph.mjs";

test("puzzle template preserves arrow binding and solves an AND lock", () => {
  const { elements } = makeScene("puzzle");
  const graph = extractGraph(elements);
  assert.equal(graph.nodes.length, 5);
  assert.equal(graph.links.length, 5);
  const arrow = elements.find(({ type }) => type === "arrow");
  assert.ok(elements.find(({ id }) => id === arrow.startBinding.elementId)
    .boundElements.some(({ id }) => id === arrow.id));
  assert.deepEqual(analyzeGraph(graph).reachableEnds, ["escape"]);
  const cut = graph.links.filter(({ from, to }) => from !== "entrance" || to !== "key");
  assert.deepEqual(analyzeGraph({ ...graph, links: cut }).unreachable, ["key", "safe", "escape"]);
  const OR = graph.nodes.map((node) => node.id === "safe" ? { ...node, mode: "any" } : node);
  assert.deepEqual(analyzeGraph({ nodes: OR, links: cut }).reachableEnds, ["escape"]);
});

test("append detects blocked cycles and dead ends", () => {
  const graph = extractGraph(appendGraph(makeScene("story").elements, [
    { id: "a", kind: "clue", label: "甲" }, { id: "b", kind: "lock", label: "乙" },
    { id: "dead", kind: "scene", label: "死胡同" },
  ], [{ from: "a", to: "b" }, { from: "b", to: "a" }, { from: "docks", to: "dead" }]));
  const report = analyzeGraph(graph);
  assert.deepEqual(report.cycleCandidates, ["a", "b"]);
  assert.deepEqual(report.unreachable, ["a", "b"]);
  assert.deepEqual(report.noEndingPath, ["dead"]);
  assert.throws(() => appendGraph([], [], [{ from: "missing", to: "other" }]));
});
