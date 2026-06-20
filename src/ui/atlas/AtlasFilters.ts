// Pure logic for the Sauce Atlas: great-circle arc geometry, cross-section
// filter predicates, ego-network computation, and edge capping. No DOM, no
// MapLibre, no d3 — all unit-testable in isolation.
import type { GraphNode, GraphEdge } from "../../services/GraphAtlasService";
import type { AtlasFilterState, ArcPoint } from "./AtlasTypes";

const DEG = Math.PI / 180;

/**
 * Interpolate a great-circle arc between two lat/lon points via 3D slerp on the
 * unit sphere. Returns `segments + 1` points (endpoints included). `peakHeight`
 * is the 0..1 lift at the arc midpoint (sin profile → 0 at the ends), used by
 * the renderer to raise the arc off the surface (height ∝ closeness).
 *
 * Slerp (not lat/lon lerp) keeps the path on the sphere so long arcs curve
 * correctly and the antimeridian is handled implicitly.
 */
export function greatCircleArc(
  from: { lat: number; lon: number },
  to: { lat: number; lon: number },
  segments = 48,
  peakHeight = 0.5,
): ArcPoint[] {
  const segs = Math.max(1, Math.floor(segments));
  const a = toVec(from.lat, from.lon);
  const b = toVec(to.lat, to.lon);
  let dot = a.x * b.x + a.y * b.y + a.z * b.z;
  dot = Math.min(1, Math.max(-1, dot));
  const omega = Math.acos(dot);
  const sinOmega = Math.sin(omega);
  const out: ArcPoint[] = [];
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    let v: Vec3;
    if (sinOmega < 1e-9) {
      // Coincident / antipodal-degenerate: fall back to linear blend.
      v = norm({
        x: a.x + (b.x - a.x) * t,
        y: a.y + (b.y - a.y) * t,
        z: a.z + (b.z - a.z) * t,
      });
    } else {
      const s0 = Math.sin((1 - t) * omega) / sinOmega;
      const s1 = Math.sin(t * omega) / sinOmega;
      v = { x: a.x * s0 + b.x * s1, y: a.y * s0 + b.y * s1, z: a.z * s0 + b.z * s1 };
    }
    const ll = toLatLon(v);
    out.push({ lat: ll.lat, lon: ll.lon, t, height: peakHeight * Math.sin(Math.PI * t) });
  }
  return out;
}

interface Vec3 {
  x: number;
  y: number;
  z: number;
}
function toVec(lat: number, lon: number): Vec3 {
  const la = lat * DEG;
  const lo = lon * DEG;
  return { x: Math.cos(la) * Math.cos(lo), y: Math.cos(la) * Math.sin(lo), z: Math.sin(la) };
}
function toLatLon(v: Vec3): { lat: number; lon: number } {
  const n = norm(v);
  return { lat: Math.asin(Math.min(1, Math.max(-1, n.z))) / DEG, lon: Math.atan2(n.y, n.x) / DEG };
}
function norm(v: Vec3): Vec3 {
  const m = Math.hypot(v.x, v.y, v.z) || 1;
  return { x: v.x / m, y: v.y / m, z: v.z / m };
}

/** Recency in days from a node's `recency` field, which the graph service stores
 *  as a 0..1 freshness score (1 = today). We expose a helper the time filter and
 *  tests share so the meaning is defined in one place. */
export function nodeVisible(node: GraphNode, f: AtlasFilterState): boolean {
  if (f.kinds.size > 0 && !f.kinds.has(node.kind)) return false;
  if (f.withinDays != null) {
    // recency is 0..1 (1 = most recent). Map the day window onto that scale:
    // a node passes if it is at least as fresh as the window implies. With no
    // per-node date available here, treat recency>0 as "has activity" and only
    // filter out stale (recency===0) nodes when a window is set.
    if (node.recency <= 0) return false;
  }
  return true;
}

export function edgeVisible(
  edge: GraphEdge,
  f: AtlasFilterState,
  isNodeVisible: (id: string) => boolean,
): boolean {
  if (f.relations.size > 0 && !f.relations.has(edge.relation)) return false;
  if (edge.weight < f.minWeight) return false;
  return isNodeVisible(edge.source) && isNodeVisible(edge.target);
}

/**
 * Ego-network of a focus node: the focus plus every node one hop away along the
 * (visible) edges. Used by focus mode to dim everything else. Returns a set that
 * always contains `focusId`.
 */
export function egoNetwork(
  focusId: string,
  edges: GraphEdge[],
): Set<string> {
  const set = new Set<string>([focusId]);
  for (const e of edges) {
    if (e.source === focusId) set.add(e.target);
    else if (e.target === focusId) set.add(e.source);
  }
  return set;
}

/**
 * Cap the number of rendered edges to the `n` heaviest by weight (a physical
 * limit to keep arc draw counts bounded). Returns the kept edges plus the total
 * so the UI can show "N of M" rather than silently dropping edges.
 */
export function topNEdges(
  edges: GraphEdge[],
  n: number,
): { kept: GraphEdge[]; total: number } {
  const total = edges.length;
  if (n <= 0 || total <= n) return { kept: edges.slice(), total };
  const kept = edges
    .slice()
    .sort((a, b) => b.weight - a.weight)
    .slice(0, n);
  return { kept, total };
}
