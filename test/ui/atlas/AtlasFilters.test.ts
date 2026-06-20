import { describe, it, expect } from "vitest";
import {
  greatCircleArc,
  nodeVisible,
  edgeVisible,
  egoNetwork,
  topNEdges,
} from "../../../src/ui/atlas/AtlasFilters";
import { emptyFilter } from "../../../src/ui/atlas/AtlasTypes";
import type {
  GraphNode,
  GraphEdge,
} from "../../../src/services/GraphAtlasService";

function node(id: string, over: Partial<GraphNode> = {}): GraphNode {
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
    file: {} as never,
    ...over,
  };
}
function edge(source: string, target: string, over: Partial<GraphEdge> = {}): GraphEdge {
  return {
    id: `${source}-${target}`,
    source,
    target,
    relation: "knows",
    directed: false,
    weight: 1,
    length: 1,
    color: "#fff",
    ...over,
  };
}

describe("greatCircleArc()", () => {
  it("returns segments+1 points starting at `from` and ending at `to`", () => {
    const a = { lat: 40.71, lon: -74.0 };
    const b = { lat: 34.05, lon: -118.24 };
    const arc = greatCircleArc(a, b, 16);
    expect(arc).toHaveLength(17);
    expect(arc[0]!.lat).toBeCloseTo(a.lat, 4);
    expect(arc[0]!.lon).toBeCloseTo(a.lon, 4);
    expect(arc.at(-1)!.lat).toBeCloseTo(b.lat, 4);
    expect(arc.at(-1)!.lon).toBeCloseTo(b.lon, 4);
  });

  it("lifts the arc: height is 0 at the endpoints and peaks at the middle", () => {
    const arc = greatCircleArc({ lat: 0, lon: 0 }, { lat: 0, lon: 40 }, 10, 0.6);
    expect(arc[0]!.height).toBeCloseTo(0, 6);
    expect(arc.at(-1)!.height).toBeCloseTo(0, 6);
    const mid = arc[5]!;
    expect(mid.height).toBeCloseTo(0.6, 6);
  });

  it("midpoint of an equatorial arc lies on the equator", () => {
    const arc = greatCircleArc({ lat: 0, lon: -20 }, { lat: 0, lon: 20 }, 8);
    expect(arc[4]!.lat).toBeCloseTo(0, 6);
    expect(arc[4]!.lon).toBeCloseTo(0, 6);
  });

  it("does not NaN for coincident endpoints", () => {
    const arc = greatCircleArc({ lat: 12, lon: 34 }, { lat: 12, lon: 34 }, 4);
    for (const p of arc) {
      expect(Number.isNaN(p.lat)).toBe(false);
      expect(Number.isNaN(p.lon)).toBe(false);
    }
  });
});

describe("nodeVisible()", () => {
  it("passes everything with an empty filter", () => {
    expect(nodeVisible(node("a"), emptyFilter())).toBe(true);
  });
  it("filters by kind allow-list", () => {
    const f = { ...emptyFilter(), kinds: new Set(["org"]) };
    expect(nodeVisible(node("a", { kind: "person" }), f)).toBe(false);
    expect(nodeVisible(node("b", { kind: "org" }), f)).toBe(true);
  });
  it("drops stale nodes when a time window is set", () => {
    const f = { ...emptyFilter(), withinDays: 30 };
    expect(nodeVisible(node("a", { recency: 0 }), f)).toBe(false);
    expect(nodeVisible(node("b", { recency: 0.5 }), f)).toBe(true);
  });
});

describe("edgeVisible()", () => {
  const all = () => true;
  it("filters by relation allow-list", () => {
    const f = { ...emptyFilter(), relations: new Set(["worked_with"]) };
    expect(edgeVisible(edge("a", "b", { relation: "knows" }), f, all)).toBe(false);
    expect(edgeVisible(edge("a", "b", { relation: "worked_with" }), f, all)).toBe(true);
  });
  it("enforces the minimum weight floor", () => {
    const f = { ...emptyFilter(), minWeight: 3 };
    expect(edgeVisible(edge("a", "b", { weight: 2 }), f, all)).toBe(false);
    expect(edgeVisible(edge("a", "b", { weight: 4 }), f, all)).toBe(true);
  });
  it("hides an edge when an endpoint is hidden", () => {
    const visible = (id: string) => id !== "b";
    expect(edgeVisible(edge("a", "b"), emptyFilter(), visible)).toBe(false);
    expect(edgeVisible(edge("a", "c"), emptyFilter(), visible)).toBe(true);
  });
});

describe("egoNetwork()", () => {
  it("returns the focus plus its direct neighbors", () => {
    const edges = [edge("a", "b"), edge("c", "a"), edge("d", "e")];
    const ego = egoNetwork("a", edges);
    expect([...ego].sort()).toEqual(["a", "b", "c"]);
  });
  it("always includes the focus even with no edges", () => {
    expect([...egoNetwork("solo", [])]).toEqual(["solo"]);
  });
});

describe("topNEdges()", () => {
  it("returns all edges (and total) when under the cap", () => {
    const edges = [edge("a", "b"), edge("c", "d")];
    const r = topNEdges(edges, 5);
    expect(r.kept).toHaveLength(2);
    expect(r.total).toBe(2);
  });
  it("keeps the heaviest N and reports the true total (no silent drop)", () => {
    const edges = [
      edge("a", "b", { weight: 1 }),
      edge("c", "d", { weight: 9 }),
      edge("e", "f", { weight: 5 }),
    ];
    const r = topNEdges(edges, 2);
    expect(r.total).toBe(3);
    expect(r.kept.map((e) => e.weight)).toEqual([9, 5]);
  });
});
