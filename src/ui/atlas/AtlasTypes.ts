// Shared types for the Sauce Atlas (unified geo + network relationship view).
// Kept dependency-free so the pure logic (data, filters, controller) is testable
// without MapLibre / d3-force / the DOM.
import type { GraphNode, GraphEdge } from "../../services/GraphAtlasService";

export type AtlasMode = "geo" | "network";

/** A node with finite lat/lon — safe to place on the map. */
export interface GeoAtlasNode extends GraphNode {
  lat: number;
  lon: number;
}

/** Cached, split view of the graph the renderers consume. Built once per data
 *  generation; selection/focus/filter changes do NOT rebuild this. */
export interface AtlasSnapshot {
  nodes: GraphNode[];
  edges: GraphEdge[];
  nodeById: Map<string, GraphNode>;
  /** Subset of `nodes` that carry finite lat/lon (Geo mode renders these). */
  geoNodes: GeoAtlasNode[];
  /** Fraction of nodes that are geocoded — drives the "N of M located" notice. */
  geoCoverage: number;
}

/** Cross-section filter state. All fields are inclusive allow-lists / floors;
 *  an empty allow-set means "no filter on this dimension" (show all). */
export interface AtlasFilterState {
  /** Allowed entity kinds (empty = all). */
  kinds: Set<string>;
  /** Allowed relation types (empty = all). */
  relations: Set<string>;
  /** Minimum edge weight (closeness floor); 0 = no floor. */
  minWeight: number;
  /** Only show nodes touched within this many days (null = no time window). */
  withinDays: number | null;
}

export function emptyFilter(): AtlasFilterState {
  return { kinds: new Set(), relations: new Set(), minWeight: 0, withinDays: null };
}

/** A point along a rendered relationship arc. `t` is 0..1 along the arc;
 *  `height` is a 0..1 lift fraction (0 at endpoints, peak at the middle). */
export interface ArcPoint {
  lat: number;
  lon: number;
  t: number;
  height: number;
}
