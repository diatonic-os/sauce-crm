// Cached data layer for the Sauce Atlas. Wraps the existing GraphAtlasService
// derivation (entities → nodes/edges) and caches the result so that hover /
// focus / filter interactions never trigger a rebuild — the defect that made
// the old Relationship Atlas janky. Takes a snapshot *source* function rather
// than the service directly, so it is unit-testable without a vault.
import type { GraphSnapshot, GraphNode } from "../../services/GraphAtlasService";
import type { AtlasSnapshot, GeoAtlasNode } from "./AtlasTypes";

function isGeoNode(n: GraphNode): n is GeoAtlasNode {
  return (
    typeof n.lat === "number" &&
    Number.isFinite(n.lat) &&
    typeof n.lon === "number" &&
    Number.isFinite(n.lon)
  );
}

export class AtlasData {
  private cache: AtlasSnapshot | null = null;

  constructor(private readonly source: () => GraphSnapshot) {}

  /** Build (or return cached) the split snapshot. Idempotent until invalidate(). */
  build(): AtlasSnapshot {
    if (this.cache) return this.cache;
    const snap = this.source();
    const geoNodes = snap.nodes.filter(isGeoNode);
    const geoCoverage =
      snap.nodes.length === 0 ? 0 : geoNodes.length / snap.nodes.length;
    this.cache = {
      nodes: snap.nodes,
      edges: snap.edges,
      nodeById: snap.nodeById,
      geoNodes,
      geoCoverage,
    };
    return this.cache;
  }

  /** Drop the cache so the next build() re-derives (call on vault changes). */
  invalidate(): void {
    this.cache = null;
  }

  get isBuilt(): boolean {
    return this.cache !== null;
  }
}
