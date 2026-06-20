// Geo renderer: relationships on a MapLibre globe. Receives the lazily-imported
// maplibre-gl module (so the heavy dep loads only when the Atlas opens) and owns
// exactly ONE Map instance, which it MUST dispose on close — a leaked WebGL
// context is unrecoverable and crashes Obsidian after a few open/close cycles.
//
// Live-verification note: WebGL rendering, the globe projection, the inlined
// tile worker and arc drawing require a live Obsidian smoke test; the seams here
// (GeoJSON building, source updates, disposal) are unit-tested.
import type {
  Map as MlMap,
  GeoJSONSource,
  StyleSpecification,
  MapMouseEvent,
} from "maplibre-gl";
import type { AtlasSnapshot, AtlasFilterState } from "./AtlasTypes";
import type { GraphEdge } from "../../services/GraphAtlasService";
import { nodesToGeoJSON, edgesToArcGeoJSON } from "./AtlasGeoJson";
import { resolveStyle, type AtlasBasemapConfig } from "./AtlasStyle";
import { edgeVisible, nodeVisible, egoNetwork, topNEdges } from "./AtlasFilters";

export type MapLibreModule = typeof import("maplibre-gl");

const SRC_NODES = "sauce-nodes";
const SRC_ARCS = "sauce-arcs";

export interface GeoRendererOpts {
  config: AtlasBasemapConfig;
  maxArcs: number;
  onSelect: (id: string) => void;
  /** Surfaced to the view so it can show "showing N of M arcs". */
  onArcCap?: (shown: number, total: number) => void;
}

export class GeoRenderer {
  private map: MlMap | null = null;
  private loaded = false;
  private pending: AtlasSnapshot | null = null;
  private focusId: string | null = null;
  private filter: AtlasFilterState | null = null;

  constructor(
    private readonly ml: MapLibreModule,
    private readonly container: HTMLElement,
    private readonly opts: GeoRendererOpts,
  ) {}

  mount(): void {
    if (this.map) return;
    this.map = new this.ml.Map({
      container: this.container,
      style: resolveStyle(this.opts.config) as StyleSpecification | string,
      center: [0, 20],
      zoom: 1.2,
      attributionControl: false,
    });
    this.map.addControl(new this.ml.NavigationControl({ visualizePitch: true }));
    this.map.on("load", () => {
      this.loaded = true;
      this.installLayers();
      if (this.pending) this.applyData(this.pending);
    });
  }

  private installLayers(): void {
    const map = this.map;
    if (!map) return;
    map.addSource(SRC_ARCS, { type: "geojson", data: emptyFc() });
    map.addSource(SRC_NODES, {
      type: "geojson",
      data: emptyFc(),
      cluster: true,
      clusterRadius: 48,
      clusterMaxZoom: 8,
      promoteId: "id",
    });
    // Relationship arcs (under the nodes). Width/opacity ∝ closeness; dimmed
    // when a focus is set and the arc is outside the ego-network.
    map.addLayer({
      id: "arcs",
      type: "line",
      source: SRC_ARCS,
      paint: {
        "line-color": ["get", "color"],
        "line-width": ["+", 0.6, ["*", 3, ["get", "closeness"]]],
        "line-opacity": ["case", ["boolean", ["get", "dim"], false], 0.08, 0.55],
      },
    });
    // Cluster bubbles for dense metros.
    map.addLayer({
      id: "clusters",
      type: "circle",
      source: SRC_NODES,
      filter: ["has", "point_count"],
      paint: {
        "circle-color": "#2563eb",
        "circle-radius": ["step", ["get", "point_count"], 14, 10, 20, 50, 28],
        "circle-opacity": 0.7,
      },
    });
    // Individual nodes. Hover/focus dimming via feature-state (no data rebuild).
    map.addLayer({
      id: "nodes",
      type: "circle",
      source: SRC_NODES,
      filter: ["!", ["has", "point_count"]],
      paint: {
        "circle-color": ["get", "color"],
        "circle-radius": ["interpolate", ["linear"], ["get", "score"], 0, 4, 10, 12],
        "circle-stroke-color": "#0b1220",
        "circle-stroke-width": 1,
        "circle-opacity": [
          "case",
          ["boolean", ["feature-state", "dim"], false],
          0.25,
          1,
        ],
      },
    });

    map.on("click", "nodes", (e: MapMouseEvent & { features?: { properties?: Record<string, unknown> }[] }) => {
      const id = e.features?.[0]?.properties?.["id"];
      if (typeof id === "string") this.opts.onSelect(id);
    });
    map.on("click", "clusters", (e: MapMouseEvent & { point: { x: number; y: number } }) => {
      const z = (map.getZoom() ?? 1) + 2;
      map.easeTo({ center: map.unproject(e.point), zoom: z });
    });
    const setCursor = (c: string) => () => {
      map.getCanvas().style.cursor = c;
    };
    map.on("mouseenter", "nodes", setCursor("pointer"));
    map.on("mouseleave", "nodes", setCursor(""));
  }

  /** Push a (possibly filtered) data generation. Cheap source.setData, never a
   *  full map/style rebuild. Safe to call before 'load' (queued in `pending`). */
  render(snapshot: AtlasSnapshot, filter: AtlasFilterState, focusId: string | null): void {
    this.filter = filter;
    this.focusId = focusId;
    if (!this.loaded) {
      this.pending = snapshot;
      return;
    }
    this.applyData(snapshot);
  }

  private applyData(snapshot: AtlasSnapshot): void {
    const map = this.map;
    if (!map) return;
    const f = this.filter;
    const visibleNode = (id: string): boolean => {
      const n = snapshot.nodeById.get(id);
      return !!n && (!f || nodeVisible(n, f));
    };
    const geoNodes = snapshot.geoNodes.filter((n) => visibleNode(n.id));
    let edges: GraphEdge[] = snapshot.edges.filter(
      (e) => !f || edgeVisible(e, f, visibleNode),
    );
    // Focus mode: restrict arcs to the ego-network of the focused node.
    const ego = this.focusId ? egoNetwork(this.focusId, edges) : null;
    if (ego) edges = edges.filter((e) => ego.has(e.source) && ego.has(e.target));
    const capped = topNEdges(edges, this.opts.maxArcs);
    this.opts.onArcCap?.(capped.kept.length, capped.total);

    (map.getSource(SRC_NODES) as GeoJSONSource | undefined)?.setData(
      nodesToGeoJSON(geoNodes) as never,
    );
    (map.getSource(SRC_ARCS) as GeoJSONSource | undefined)?.setData(
      edgesToArcGeoJSON(capped.kept, snapshot.nodeById) as never,
    );
    // Dim nodes outside the focus ego-network via feature-state (GPU paint).
    for (const n of geoNodes) {
      const dim = ego ? !ego.has(n.id) : false;
      try {
        map.setFeatureState({ source: SRC_NODES, id: n.id }, { dim });
      } catch {
        /* feature not yet in the tile index; ignored */
      }
    }
  }

  flyTo(lat: number, lon: number): void {
    this.map?.flyTo({ center: [lon, lat], zoom: 9 });
  }

  /** Critical: free the WebGL context. Called on view close AND mode switch. */
  dispose(): void {
    if (this.map) {
      this.map.remove();
      this.map = null;
    }
    this.loaded = false;
    this.pending = null;
  }
}

function emptyFc(): { type: "FeatureCollection"; features: [] } {
  return { type: "FeatureCollection", features: [] };
}
