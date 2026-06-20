import { describe, it, expect } from "vitest";
import {
  nodesToGeoJSON,
  edgesToArcGeoJSON,
} from "../../../src/ui/atlas/AtlasGeoJson";
import {
  graticuleGeoJSON,
  buildOfflineStyle,
  resolveStyle,
} from "../../../src/ui/atlas/AtlasStyle";
import type {
  GraphNode,
  GraphEdge,
} from "../../../src/services/GraphAtlasService";
import type { GeoAtlasNode } from "../../../src/ui/atlas/AtlasTypes";

function geoNode(id: string, lat: number, lon: number): GeoAtlasNode {
  return {
    id,
    path: `${id}.md`,
    label: id,
    kind: "person",
    layer: 1,
    color: "#abc",
    icon: "x",
    score: 2,
    degree: 1,
    recency: 1,
    geo: 1,
    interactions: 0,
    radius: 4,
    mass: 1,
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    lat,
    lon,
    file: {} as never,
  };
}
function edge(source: string, target: string, weight = 1): GraphEdge {
  return {
    id: `${source}-${target}`,
    source,
    target,
    relation: "knows",
    directed: false,
    weight,
    length: 1,
    color: "#def",
  };
}

describe("nodesToGeoJSON()", () => {
  it("emits [lon,lat] Point features with id promoted into properties", () => {
    const fc = nodesToGeoJSON([geoNode("a", 40, -74)]);
    expect(fc.type).toBe("FeatureCollection");
    expect(fc.features[0]!.geometry.coordinates).toEqual([-74, 40]); // lon,lat order
    expect(fc.features[0]!.properties.id).toBe("a");
    expect(fc.features[0]!.properties.kind).toBe("person");
  });
});

describe("edgesToArcGeoJSON()", () => {
  it("builds a LineString arc for edges with two geocoded endpoints", () => {
    const byId = new Map<string, GraphNode>([
      ["a", geoNode("a", 0, 0)],
      ["b", geoNode("b", 0, 40)],
    ]);
    const fc = edgesToArcGeoJSON([edge("a", "b", 5)], byId, 16, 5);
    expect(fc.features).toHaveLength(1);
    expect(fc.features[0]!.geometry.coordinates).toHaveLength(17);
    expect(fc.features[0]!.properties.closeness).toBe(1); // 5/5
  });

  it("skips edges with an un-geocoded endpoint", () => {
    const ungeo = { ...geoNode("b", 0, 0) } as GraphNode;
    delete (ungeo as Partial<GraphNode>).lat;
    delete (ungeo as Partial<GraphNode>).lon;
    const byId = new Map<string, GraphNode>([["a", geoNode("a", 0, 0)], ["b", ungeo]]);
    expect(edgesToArcGeoJSON([edge("a", "b")], byId).features).toHaveLength(0);
  });
});

describe("AtlasStyle", () => {
  it("offline style is a valid v8 spec with globe projection and no glyphs", () => {
    const s = buildOfflineStyle();
    expect(s.version).toBe(8);
    expect((s.projection as { type: string }).type).toBe("globe");
    expect(s.glyphs).toBeUndefined(); // offline: no font server dependency
    expect(Array.isArray(s.layers)).toBe(true);
  });

  it("graticule produces meridians and parallels", () => {
    const g = graticuleGeoJSON(30);
    const kinds = new Set(g.features.map((f) => f.properties.kind));
    expect(kinds.has("meridian")).toBe(true);
    expect(kinds.has("parallel")).toBe(true);
  });

  it("resolveStyle returns the URL online, else the offline object", () => {
    expect(resolveStyle({ mode: "online", styleUrl: "https://x/y.json" })).toBe(
      "https://x/y.json",
    );
    expect(typeof resolveStyle({ mode: "offline" })).toBe("object");
    // pmtiles falls back to offline (Phase 2) rather than breaking
    expect(typeof resolveStyle({ mode: "pmtiles", pmtilesPath: "/a.pmtiles" })).toBe(
      "object",
    );
  });
});
