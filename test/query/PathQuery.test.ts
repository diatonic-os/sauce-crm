import { describe, it, expect } from "vitest";
import { runPath, buildMatrix } from "../../src/query/PathQuery";
import type { AdjacencyRow } from "../../src/query/PathQuery";
import { MaxPlus } from "../../src/semiring/MaxPlus";

const E = (src: string, dst: string, weight: number, edge = "knows"): AdjacencyRow => ({
  src,
  dst,
  edge,
  weight,
});

describe("runPath()", () => {
  it("MAXIMIZE: returned path weight matches the returned metric (regression)", () => {
    const nodes = ["A", "B", "C"];
    const edges = [E("A", "C", 100), E("A", "B", 1), E("B", "C", 1000)];
    const res = runPath(nodes, edges, "A", "C", undefined, {
      mode: "MAXIMIZE",
      metric: "warmth",
    });
    expect(res).not.toBeNull();
    expect(res!.nodes).toEqual(["A", "B", "C"]);
    expect(res!.metric).toBe(1001);
  });

  it("MINIMIZE: shortest multi-hop route wins", () => {
    const nodes = ["A", "B", "C"];
    const edges = [E("A", "C", 100), E("A", "B", 1), E("B", "C", 1)];
    const res = runPath(nodes, edges, "A", "C", undefined, {
      mode: "MINIMIZE",
      metric: "hops",
    });
    expect(res!.nodes).toEqual(["A", "B", "C"]);
    expect(res!.metric).toBe(2);
  });

  it("returns null when the target is unreachable", () => {
    const res = runPath(["A", "B", "C"], [E("A", "B", 1)], "A", "C", undefined, {
      mode: "MINIMIZE",
      metric: "hops",
    });
    expect(res).toBeNull();
  });

  it("respects the edge-type filter (`over`)", () => {
    const nodes = ["A", "B"];
    const edges = [E("A", "B", 1, "worked_with")];
    expect(
      runPath(nodes, edges, "A", "B", ["knows"], { mode: "MINIMIZE", metric: "h" }),
    ).toBeNull();
    expect(
      runPath(nodes, edges, "A", "B", ["worked_with"], {
        mode: "MINIMIZE",
        metric: "h",
      }),
    ).not.toBeNull();
  });
});

describe("buildMatrix() weight validation", () => {
  it("rejects non-finite weights so they cannot poison the matrix", () => {
    const nodes = ["A", "B"];
    const m = buildMatrix(MaxPlus, nodes, [E("A", "B", NaN), E("A", "B", Infinity)]);
    // No finite edge was inserted → A→B stays at ⊕-zero (-Infinity for MaxPlus).
    expect(m[0]![1]).toBe(MaxPlus.zero);
  });

  it("keeps finite weights", () => {
    const m = buildMatrix(MaxPlus, ["A", "B"], [{ src: "A", dst: "B", edge: "k", weight: 3 }]);
    expect(m[0]![1]).toBe(3);
  });
});
