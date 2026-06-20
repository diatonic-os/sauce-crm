// Sauce Atlas — one view, two modes (Geo globe ⇄ Network force graph), replacing
// the old abstract Relationship Atlas + Map. Lazily imports the heavy engines
// (maplibre-gl, d3-force) on first open so plugin startup is unaffected, and
// disposes the active renderer on close AND on mode switch (frees the WebGL
// context — never leak it).
import { ItemView, WorkspaceLeaf, setIcon, debounce } from "obsidian";
import type SauceGraphPlugin from "../../main";
import { type ViewTypeId, asViewTypeId } from "@/types/brands";
import { GraphAtlasService } from "../../services/GraphAtlasService";
import { AtlasData } from "./AtlasData";
import { AtlasController } from "./AtlasController";
import type { AtlasMode } from "./AtlasTypes";
import { GeoRenderer, type MapLibreModule } from "./GeoRenderer";
import { NetworkRenderer, type D3ForceModule } from "./NetworkRenderer";
import { DEFAULT_BASEMAP, type AtlasBasemapConfig } from "./AtlasStyle";

export const VIEW_ATLAS: ViewTypeId = asViewTypeId("sauce-atlas");

const RELATIONS = ["knows", "worked_with", "family_of", "org"] as const;

interface AtlasConfig {
  basemap: AtlasBasemapConfig;
  defaultMode: AtlasMode;
  maxArcs: number;
  maxNodes: number;
}

export class AtlasView extends ItemView {
  private data: AtlasData;
  private controller: AtlasController;
  private geo: GeoRenderer | null = null;
  private network: NetworkRenderer | null = null;
  private mlModule: MapLibreModule | null = null;
  private d3Module: D3ForceModule | null = null;
  private stage!: HTMLDivElement;
  private notice!: HTMLDivElement;
  private resizeObs: ResizeObserver | null = null;
  private cfg: AtlasConfig;

  constructor(
    leaf: WorkspaceLeaf,
    public plugin: SauceGraphPlugin,
  ) {
    super(leaf);
    this.cfg = readAtlasConfig(plugin);
    this.controller = new AtlasController(this.cfg.defaultMode);
    this.data = new AtlasData(() =>
      new GraphAtlasService(plugin.app, plugin.entityService).snapshot({
        width: 1200,
        height: 1200,
      }),
    );
  }

  getViewType(): string {
    return VIEW_ATLAS;
  }
  getDisplayText(): string {
    return "Sauce Atlas";
  }
  override getIcon(): string {
    return "globe";
  }

  override async onOpen(): Promise<void> {
    const root = this.contentEl;
    root.empty();
    root.addClass("sauce-view", "sauce-atlas-view");
    this.buildControlBar(root);
    this.stage = root.createDiv({ cls: "sauce-atlas-stage" });
    this.notice = root.createDiv({ cls: "sauce-atlas-notice" });

    // Lazy-load the heavy engines only now that the view is open (cached by the
    // bundler, so a later mode toggle reuses them synchronously).
    try {
      const [mlMod, d3Mod] = await Promise.all([
        import("maplibre-gl"),
        import("d3-force"),
      ]);
      this.mlModule =
        (mlMod as { default?: MapLibreModule }).default ?? (mlMod as MapLibreModule);
      this.d3Module = d3Mod;
    } catch (e) {
      this.notice.setText(
        "Atlas engine failed to load (WebGL unavailable?). Open on desktop.",
      );
      this.plugin.logger?.warn?.("atlas.engine-load-failed", { error: String(e) });
      return;
    }

    this.controller.on((change) => this.onControllerChange(change));
    this.resizeObs = new ResizeObserver(
      debounce(() => {
        if (this.controller.mode === "geo") this.geoResize();
      }, 150),
    );
    this.resizeObs.observe(this.stage);

    this.recreateRenderers();
  }

  override async onClose(): Promise<void> {
    this.resizeObs?.disconnect();
    this.resizeObs = null;
    this.disposeRenderers();
  }

  /** Invalidate cached data + re-render (wired to a vault-change debounce). */
  refresh(): void {
    this.data.invalidate();
    if (this.mlModule) this.renderActive();
  }

  // — internals —

  private buildControlBar(root: HTMLElement): void {
    const bar = root.createDiv({ cls: "sauce-atlas-bar" });

    const modes = bar.createDiv({ cls: "sauce-atlas-modes" });
    const mk = (mode: AtlasMode, label: string, icon: string): void => {
      const b = modes.createEl("button", {
        cls: "sauce-atlas-mode-btn",
        attr: { type: "button" },
      });
      setIcon(b.createSpan({ cls: "sauce-atlas-mode-icon" }), icon);
      b.createSpan({ text: label });
      b.toggleClass("is-active", this.controller.mode === mode);
      b.dataset.mode = mode;
      b.onclick = () => this.controller.setMode(mode);
    };
    mk("geo", "Geo", "globe");
    mk("network", "Network", "git-fork");

    const search = bar.createEl("input", {
      cls: "sauce-atlas-search",
      attr: { type: "search", placeholder: "Search a person or org…" },
    });
    search.oninput = debounce(() => this.runSearch(search.value), 200);

    const filters = bar.createDiv({ cls: "sauce-atlas-filters" });
    for (const rel of RELATIONS) {
      const chip = filters.createEl("button", {
        cls: "sauce-atlas-chip",
        text: rel,
        attr: { type: "button" },
      });
      chip.onclick = () => {
        const next = new Set(this.controller.filter.relations);
        if (next.has(rel)) next.delete(rel);
        else next.add(rel);
        chip.toggleClass("is-active", next.has(rel));
        this.controller.setFilter({ relations: next });
      };
    }
    const closeness = filters.createEl("input", {
      cls: "sauce-atlas-closeness",
      attr: {
        type: "range",
        min: "0",
        max: "5",
        step: "1",
        value: "0",
        "aria-label": "Minimum closeness",
      },
    });
    closeness.oninput = debounce(
      () => this.controller.setFilter({ minWeight: Number(closeness.value) }),
      150,
    );

    const clear = bar.createEl("button", {
      cls: "sauce-atlas-clear",
      text: "Clear focus",
      attr: { type: "button" },
    });
    clear.onclick = () => this.controller.setFocus(null);
  }

  private onControllerChange(change: string): void {
    if (change === "mode") {
      this.recreateRenderers();
      this.syncModeButtons();
    } else if (change === "focus" && this.controller.mode === "network") {
      this.network?.refocus(this.controller.focusId);
    } else {
      this.renderActive();
    }
  }

  /** Dispose both renderers (frees WebGL context), then build fresh instances
   *  using the cached engine modules and mount + render the active one. Called
   *  on open and on every mode toggle, so toggling repeatedly never leaks. */
  private recreateRenderers(): void {
    if (!this.mlModule || !this.d3Module) return;
    this.disposeRenderers();
    this.stage.empty();
    this.geo = new GeoRenderer(this.mlModule, this.stage, {
      config: this.cfg.basemap,
      maxArcs: this.cfg.maxArcs,
      onSelect: (id) => this.controller.setFocus(id),
      onArcCap: (shown, total) => this.updateNotice(shown, total),
    });
    this.network = new NetworkRenderer(this.d3Module, this.stage, {
      onSelect: (id) => this.controller.setFocus(id),
      maxNodes: this.cfg.maxNodes,
    });
    if (this.controller.mode === "geo") this.geo.mount();
    else this.network.mount();
    this.renderActive();
  }

  private disposeRenderers(): void {
    this.geo?.dispose();
    this.network?.dispose();
    this.geo = null;
    this.network = null;
  }

  private renderActive(): void {
    const snap = this.data.build();
    if (this.controller.mode === "geo") {
      this.geo?.render(snap, this.controller.filter, this.controller.focusId);
      this.updateNotice(
        null,
        null,
        snap.geoCoverage,
        snap.geoNodes.length,
        snap.nodes.length,
      );
    } else {
      this.network?.render(snap, this.controller.filter, this.controller.focusId);
    }
  }

  private geoResize(): void {
    (this.geo as unknown as { map?: { resize(): void } } | null)?.map?.resize?.();
  }

  private runSearch(q: string): void {
    const term = q.trim().toLowerCase();
    if (!term) return;
    const snap = this.data.build();
    const hit =
      snap.nodes.find((n) => n.label.toLowerCase() === term) ??
      snap.nodes.find((n) => n.label.toLowerCase().includes(term));
    if (!hit) return;
    this.controller.setFocus(hit.id);
    if (
      this.controller.mode === "geo" &&
      typeof hit.lat === "number" &&
      typeof hit.lon === "number"
    ) {
      this.geo?.flyTo(hit.lat, hit.lon);
    }
  }

  private syncModeButtons(): void {
    this.contentEl.findAll(".sauce-atlas-mode-btn").forEach((el) => {
      el.toggleClass(
        "is-active",
        (el as HTMLElement).dataset.mode === this.controller.mode,
      );
    });
  }

  private updateNotice(
    arcsShown: number | null,
    arcsTotal: number | null,
    coverage?: number,
    geoCount?: number,
    total?: number,
  ): void {
    const parts: string[] = [];
    if (coverage != null && total != null && geoCount != null) {
      parts.push(
        `${geoCount} of ${total} located (${Math.round(coverage * 100)}%)`,
      );
    }
    if (arcsShown != null && arcsTotal != null && arcsTotal > arcsShown) {
      parts.push(`showing ${arcsShown} of ${arcsTotal} relationships`);
    }
    if (parts.length) this.notice.setText(parts.join(" · "));
  }
}

function readAtlasConfig(plugin: SauceGraphPlugin): AtlasConfig {
  const raw = (
    plugin.settings as { features?: { atlas?: Partial<AtlasConfig> } }
  )?.features?.atlas;
  return {
    basemap: raw?.basemap ?? DEFAULT_BASEMAP,
    defaultMode: raw?.defaultMode ?? "geo",
    maxArcs: raw?.maxArcs ?? 1500,
    maxNodes: raw?.maxNodes ?? 600,
  };
}
