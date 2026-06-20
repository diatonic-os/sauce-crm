import { describe, it, expect, vi } from "vitest";
import { AtlasData } from "../../../src/ui/atlas/AtlasData";
import type {
  GraphSnapshot,
  GraphNode,
} from "../../../src/services/GraphAtlasService";

function node(id: string, lat?: number, lon?: number): GraphNode {
  return {
    id,
    path: `${id}.md`,
    label: id,
    kind: "person",
    layer: 1,
    color: "#fff",
    icon: "x",
    score: 1,
    degree: 0,
    recency: 1,
    geo: 0,
    interactions: 0,
    radius: 4,
    mass: 1,
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    ...(lat !== undefined ? { lat } : {}),
    ...(lon !== undefined ? { lon } : {}),
    file: {} as never,
  };
}

function snap(nodes: GraphNode[]): GraphSnapshot {
  return { nodes, edges: [], nodeById: new Map(nodes.map((n) => [n.id, n])) };
}

describe("AtlasData", () => {
  it("splits out geo nodes and computes coverage", () => {
    const nodes = [node("a", 40, -74), node("b"), node("c", 1, 2), node("d", NaN, 5)];
    const data = new AtlasData(() => snap(nodes));
    const built = data.build();
    expect(built.geoNodes.map((n) => n.id).sort()).toEqual(["a", "c"]);
    expect(built.geoCoverage).toBeCloseTo(2 / 4, 10);
  });

  it("caches: build() calls the source only once until invalidated", () => {
    const source = vi.fn(() => snap([node("a", 1, 2)]));
    const data = new AtlasData(source);
    data.build();
    data.build();
    expect(source).toHaveBeenCalledTimes(1);
    data.invalidate();
    data.build();
    expect(source).toHaveBeenCalledTimes(2);
  });

  it("handles an empty graph without dividing by zero", () => {
    const data = new AtlasData(() => snap([]));
    const built = data.build();
    expect(built.geoNodes).toEqual([]);
    expect(built.geoCoverage).toBe(0);
  });
});
