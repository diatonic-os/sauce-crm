// Basemap config + MapLibre style builder. Pure (no maplibre import) so the
// offline-style/graticule construction is unit-testable. The offline default
// uses NO glyphs/sprites/tiles — just a background + graticule — so it renders
// fully offline and private with zero network calls and no font dependency.
import type { LineFeature, FeatureCollection } from "./AtlasGeoJson";

export type BasemapMode = "offline" | "online" | "pmtiles";

export interface AtlasBasemapConfig {
  mode: BasemapMode;
  /** Online vector style URL (only used when mode === "online"). */
  styleUrl?: string;
  /** Local PMTiles file path (mode === "pmtiles"; full wiring is Phase 2). */
  pmtilesPath?: string;
}

export const DEFAULT_BASEMAP: AtlasBasemapConfig = { mode: "offline" };

/** Loose style spec type — MapLibre's setStyle accepts a plain object or URL. */
export type AtlasStyleSpec = Record<string, unknown>;

/** Meridians + parallels as GeoJSON lines, for the offline globe so it doesn't
 *  read as a featureless sphere. `stepDeg` controls grid density. */
export function graticuleGeoJSON(stepDeg = 30): FeatureCollection<LineFeature> {
  const features: LineFeature[] = [];
  for (let lon = -180; lon <= 180; lon += stepDeg) {
    const coords: [number, number][] = [];
    for (let lat = -80; lat <= 80; lat += 5) coords.push([lon, lat]);
    features.push({
      type: "Feature",
      geometry: { type: "LineString", coordinates: coords },
      properties: { kind: "meridian" },
    });
  }
  for (let lat = -60; lat <= 60; lat += stepDeg) {
    const coords: [number, number][] = [];
    for (let lon = -180; lon <= 180; lon += 5) coords.push([lon, lat]);
    features.push({
      type: "Feature",
      geometry: { type: "LineString", coordinates: coords },
      properties: { kind: "parallel" },
    });
  }
  return { type: "FeatureCollection", features };
}

/** Fully-offline globe style: dark ocean background + graticule. No glyphs, so
 *  no text layers (node labels come from circle markers + click/hover, not
 *  symbol text-fields that would require a font server). */
export function buildOfflineStyle(): AtlasStyleSpec {
  return {
    version: 8,
    name: "sauce-atlas-offline",
    projection: { type: "globe" },
    sources: {
      "sauce-graticule": { type: "geojson", data: graticuleGeoJSON() },
    },
    layers: [
      { id: "bg", type: "background", paint: { "background-color": "#081019" } },
      {
        id: "graticule",
        type: "line",
        source: "sauce-graticule",
        paint: { "line-color": "#16263b", "line-width": 0.6 },
      },
    ],
  };
}

/**
 * Resolve the basemap into something MapLibre's `style` option accepts: the
 * offline style object, or an online style URL string. PMTiles styling is
 * Phase 2 (the protocol is registered in GeoRenderer regardless); until then a
 * pmtiles config falls back to the offline style so the view never breaks.
 */
export function resolveStyle(cfg: AtlasBasemapConfig): AtlasStyleSpec | string {
  if (cfg.mode === "online" && cfg.styleUrl) return cfg.styleUrl;
  return buildOfflineStyle();
}
