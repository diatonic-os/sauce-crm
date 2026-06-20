# Sauce Atlas — Design Spec

Date: 2026-06-20
Status: approved (operator delegated engineering decisions: "you decide with the
senior dev lens of what to avoid and how to optimize for physical limits")

## 1. Goal

Replace the two weak, overlapping surfaces — the abstract **Relationship Atlas**
(`TypedEdgeGraphView`, `sauce-graph-view`) and the **Map** (`MapViewReal`,
`sauce-crm-map`) — with one fast, noise-reduced **Sauce Atlas** view.

- **Geo mode** (default): a MapLibre GL map that renders as a 3D globe when
  zoomed out and seamlessly flattens to a street map when zoomed into a town.
  Orgs/people sit at real `lat`/`lon`; relationships render as great-circle
  **arcs lifted off the surface** (height ∝ closeness).
- **Network mode**: a real `d3-force` layout of **all** entities (including
  un-geocoded ones), so nothing is hidden when coordinates are missing.
- Shared selection / focus / filters across both modes. WebGL/GPU throughout.

Decisions locked with the operator:
1. Engine = **MapLibre GL + PMTiles**, offline & private by default.
2. **One unified view** with a Geo ⇄ Network toggle (replaces both old views).
3. "3D" = **globe→flat + lifted relationship arcs**.

## 2. Why the current surfaces fail (problem statement)

- `TypedEdgeGraphView` rebuilds the entire `GraphAtlasService` and re-snapshots
  the whole graph on **every hover** (`onmouseenter → scheduleRender`), and
  renders each node as an absolutely-positioned DOM `<button>`. Result: overlap,
  jank, no zoom/pan, no real physics despite the "force graph" copy.
- `MapViewReal` plots dots on a **blank** equirectangular `<canvas>` — no
  basemap, no zoom, no edges.
- Neither shows relationships *on a real map*, which is the actual ask.

## 3. Architecture (isolated, testable units)

| Unit | Responsibility | Depends on |
|---|---|---|
| `AtlasView` (ItemView, `VIEW_ATLAS`) | Shell, Geo/Network toggle, control bar, lifecycle, lazy engine load | renderers, controller |
| `AtlasData` | Build `{nodes, edges}` from `entityService` **once, cached**; expose geo subset (has lat/lon) + full set; pure | entityService |
| `AtlasController` | Shared selection/focus/filter state; emits cheap "style" deltas | — |
| `GeoRenderer` | Wrap MapLibre; node layer (clustered), arc layer; focus/dim via feature-state + paint expressions | maplibre-gl, pmtiles |
| `NetworkRenderer` | `d3-force` layout for all entities on one `<canvas>`; time-boxed sim | d3-force |
| `AtlasFilters` (pure) | Predicates for edge-type / entity-type / closeness-tier / time window; arc geometry; cluster bucketing | — |
| Atlas settings | basemap source (offline vector / local pmtiles path / online URL), default mode, node/arc caps | PluginConfigService |

Data flow: `entityService → AtlasData.snapshot() (cached) → AtlasFilters → GeoRenderer | NetworkRenderer`, with `AtlasController` broadcasting selection/filter changes as **paint/feature-state updates** (never a relayout).

## 4. Rendering & dependencies

The plugin currently has **zero runtime deps**. We add (lazy):
- `maplibre-gl` (~200KB gzip), `pmtiles` (PMTiles protocol, range reads), `d3-force` (small).
- **Lazy dynamic `import()` on first Atlas open**, module cached — startup bundle and launch time unchanged for users who never open the Atlas (mirrors the existing lazy-require of LanceDB / pdf-parse / mammoth).

Basemap tiers (honest about offline reach):
- **Offline default**: a bundled **Natural-Earth vector** (countries + coastline, target < 300 KB) → world/region zoom, fully private. With no PMTiles configured, deep zoom shows region-level vector, *not* streets.
- **Street detail**: user points settings at a **local `.pmtiles`** file (offline, private; pmtiles does range reads, loading only visible tiles) **or** explicitly opts into an **online tile URL** — only then do coordinates reach a third party.

## 5. Interaction / noise reduction (the core UX fix)

- **Clustering**: cluster nodes at low zoom (MapLibre cluster) to collapse dense
  metros; click a cluster to zoom/expand.
- **Focus mode**: click a node → isolate its ego-network (node + direct
  neighbors), dim the rest, fade distant arcs; `Esc` clears. Hover = light
  highlight only (a cheap feature-state change — no relayout).
- **Cross-section filters** (all instant paint/filter updates, no rebuild):
  edge-type (knows / worked_with / family / company), entity-type (person/org),
  closeness-tier slider, last-touch time window.
- **Search → fly-to + focus** a node.
- Arc height ∝ closeness; arc opacity decays with graph-distance from focus.

## 6. What to AVOID + physical-limit optimizations (senior lens)

Hard rules baked into the design:

1. **WebGL context exhaustion (critical).** Browsers cap live WebGL contexts at
   ~16; leaking them crashes the whole app. `GeoRenderer` MUST call
   `map.remove()` in `AtlasView.onClose()` and on Geo→Network toggle teardown.
   One map instance at a time; never orphan a context.
2. **No planet tiles in the bundle.** Bundled basemap stays a tiny vector
   (< 300 KB). Street tiles are user-supplied/opt-in. Keeps the plugin within
   community-store size norms.
3. **No eager engine load.** MapLibre/d3-force load lazily on first open; never
   at plugin `onload`. Startup time must not regress.
4. **No per-hover rebuilds** (the current bug). Build the snapshot once and
   cache; interaction touches GPU feature-state/paint only.
5. **No DOM-node-per-graph-node.** Geo nodes are a single GeoJSON layer; Network
   nodes are drawn on one `<canvas>`. Hundreds of positioned DOM buttons are
   banned.
6. **Time-box the force sim.** `d3-force` runs with alpha decay and a hard tick
   budget (e.g. ≤ 300 ticks / ~2 s), then freezes; never an open-ended
   animation loop. Run in `requestAnimationFrame` chunks (or a worker if
   available) so the main thread isn't blocked.
7. **Cull aggressively.** Cluster at low zoom; render only viewport + focus
   ego-network edges; cap visible arcs to top-N by weight with an explicit
   "showing N of M" notice — **no silent truncation**.
8. **Cap node/edge counts** with a configurable limit; degrade gracefully (the
   Network sim caps live nodes; excess shown clustered/collapsed).
9. **Mobile** (`isDesktopOnly: false`): MapLibre is GPU/memory-heavy. Detect
   WebGL availability; on mobile default to a reduced node cap and verify the
   map initializes, with a graceful "open on desktop for the full atlas" fallback
   rather than a crash. Do not assume WebGL2.
10. **Dispose everything on close.** `map.remove()`, cancel rAF, disconnect
    observers, stop the sim, drop cached module refs held by the view (keep the
    lazily-imported module cached at module scope, not per-view).

Frame budget: all focus/filter interactions are GPU feature-state updates inside
the 16 ms budget. Draw calls minimized via few data-driven layers. Filter input
debounced.

## 7. Migration

- New `VIEW_ATLAS` (`sauce-atlas`) supersedes `VIEW_GRAPH` and `VIEW_MAP_REAL`.
- Old IDs **alias** to the Atlas so saved workspace layouts and existing commands
  keep working (register the Atlas factory for the legacy IDs, or redirect on
  open). Nothing the operator has pinned breaks.
- Ribbon launcher entries "Typed-Edge Graph" and "Map" become a single
  "Sauce Atlas" entry.
- Delete `TypedEdgeGraphView` (in `Views.ts`) and `MapViewReal.ts` once the Atlas
  covers them. Reuse `GraphAtlasService` data; keep `GeoIndex`/`haversineMeters`
  (hardened in Wave 1) for distance/nearest.

## 8. Testing

Unit-test the pure logic with MapLibre/d3 stubbed:
- `AtlasData` snapshot: node/edge construction, geo subset split, caching (no
  rebuild on repeated calls / on selection change).
- `AtlasFilters`: edge-type/entity-type/closeness/time predicates; arc
  great-circle + height geometry; cluster bucketing; top-N arc cap + count.
- `AtlasController`: selection/focus transitions emit style deltas, not rebuilds.
Thin integration test mounts `AtlasView` with a stubbed engine to assert
lifecycle (`onClose` disposes the map → no leaked context).
Renderer WebGL output itself is verified by a **live smoke test in Obsidian**
(documented), since headless WebGL is out of scope for vitest.

## 9. Phasing

**Phase 1 (this feature):**
- `AtlasView` + toggle + control bar + settings (basemap source, default mode, caps).
- Geo mode: offline vector basemap, clustered nodes, relationship arcs, focus
  mode, cross-section filters, search fly-to, globe→flat projection.
- Network mode: time-boxed `d3-force` layout of all entities, shared selection.
- Migration (alias old IDs, update ribbon, delete old views) + full unit tests.

**Phase 2 (follow-up):**
- Local-PMTiles street detail + online opt-in flow + tile settings UX.
- Time cross-section polish; arc-height tuning; pin-drop geocoding for
  un-geocoded entities; optional web-worker force sim.

## 10. Open verification note

WebGL rendering, globe projection, arc layers and tile loading require a live
Obsidian smoke test (the pure logic and lifecycle are unit-tested + build-gated).
This will be called out explicitly at hand-off rather than claimed as verified.
