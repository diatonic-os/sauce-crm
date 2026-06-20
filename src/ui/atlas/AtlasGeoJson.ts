// Pure GeoJSON builders for the Geo renderer. Kept separate from MapLibre so the
// feature construction (the part that can break silently) is unit-testable.
import type { GraphNode, GraphEdge } from "../../services/GraphAtlasService";
import type { GeoAtlasNode } from "./AtlasTypes";
import { greatCircleArc } from "./AtlasFilters";

// Minimal GeoJSON shapes (we avoid a @types/geojson dep; MapLibre accepts plain
// objects matching this structure).
export interface PointFeature {
  type: "Feature";
  geometry: { type: "Point"; coordinates: [number, number] };
  properties: Record<string, string | number>;
}
export interface LineFeature {
  type: "Feature";
  geometry: { type: "LineString"; coordinates: [number, number][] };
  properties: Record<string, string | number>;
}
export interface FeatureCollection<F> {
  type: "FeatureCollection";
  features: F[];
}

/** Point features for geocoded nodes. `id` is promoted so MapLibre feature-state
 *  (used for focus/hover styling without a data rebuild) can key off it. */
export function nodesToGeoJSON(
  nodes: GeoAtlasNode[],
): FeatureCollection<PointFeature> {
  return {
    type: "FeatureCollection",
    features: nodes.map((n) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [n.lon, n.lat] },
      properties: {
        id: n.id,
        kind: n.kind,
        label: n.label,
        color: n.color,
        score: n.score,
        degree: n.degree,
      },
    })),
  };
}

/**
 * LineString features for edges whose BOTH endpoints are geocoded, each a
 * great-circle arc (curves correctly on the globe). Edges with a missing/
 * un-geocoded endpoint are skipped (they live in Network mode instead).
 * `closeness` (0..1, from weight) is carried for width/opacity styling and as
 * the arc-height input a future 3D custom layer can use.
 */
export function edgesToArcGeoJSON(
  edges: GraphEdge[],
  nodeById: Map<string, GraphNode>,
  segments = 48,
  maxWeight = 5,
): FeatureCollection<LineFeature> {
  const features: LineFeature[] = [];
  for (const e of edges) {
    const s = nodeById.get(e.source);
    const t = nodeById.get(e.target);
    if (!isGeo(s) || !isGeo(t)) continue;
    const closeness = maxWeight > 0 ? Math.min(1, e.weight / maxWeight) : 0;
    const arc = greatCircleArc(
      { lat: s.lat, lon: s.lon },
      { lat: t.lat, lon: t.lon },
      segments,
      closeness,
    );
    features.push({
      type: "Feature",
      geometry: { type: "LineString", coordinates: arc.map((p) => [p.lon, p.lat]) },
      properties: {
        id: e.id,
        source: e.source,
        target: e.target,
        relation: e.relation,
        weight: e.weight,
        closeness,
        color: e.color,
      },
    });
  }
  return { type: "FeatureCollection", features };
}

function isGeo(n: GraphNode | undefined): n is GeoAtlasNode {
  return (
    !!n &&
    typeof n.lat === "number" &&
    Number.isFinite(n.lat) &&
    typeof n.lon === "number" &&
    Number.isFinite(n.lon)
  );
}
