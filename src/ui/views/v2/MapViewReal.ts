// MapViewReal (sauce-crm-map) — the REGISTERED map view. Plots vault entities
// that carry lat/lon frontmatter onto a canvas with an equirectangular
// projection (good-enough at personal-graph scale). Click a dot to open the
// underlying note. When no entity is geo-coded yet it shows a genuine,
// actionable empty state rather than a "pending implementation" placeholder.
//
// NOTE: the older `MapView` (sauce-map) class carried this implementation but
// was never registered; this registered `*Real` class is the live view-type
// wired into the ribbon + command palette. The drawing logic is consolidated
// here so the wired surface renders real data. See W4 nav-surface notes.

import { ItemView, WorkspaceLeaf } from "obsidian";
import { openVaultPath } from "../../util/openVaultFile";
import type SauceGraphPlugin from "../../../main";
import { type ViewTypeId, asViewTypeId } from "@/types/brands";
import { SauceViewHelp } from "../../components/v2/SauceViewHelp";

export const VIEW_MAP_REAL: ViewTypeId = asViewTypeId("sauce-crm-map");

interface Plot {
  x: number;
  y: number;
  basename: string;
  path: string;
  lat: number;
  lon: number;
  kind: "person" | "org";
}

export class MapViewReal extends ItemView {
  private canvas: HTMLCanvasElement | null = null;
  private plots: Plot[] = [];
  private help!: SauceViewHelp;

  constructor(
    leaf: WorkspaceLeaf,
    public plugin: SauceGraphPlugin,
  ) {
    super(leaf);
  }

  getViewType(): string {
    return VIEW_MAP_REAL;
  }
  getDisplayText(): string {
    return "Sauce CRM — Map";
  }
  override getIcon(): string {
    return "map";
  }

  override async onOpen(): Promise<void> {
    const root = this.contentEl;
    root.empty();
    root.addClass("sauce-view");
    root.addClass("sauce-map");
    this.help = new SauceViewHelp();
    this.help.mountHeader(root, {
      title: "Map",
      icon: "map",
      subtitle: "Geo-coded people and orgs on a map",
    });

    const points = this.collect();
    if (points.length === 0) {
      this.renderEmpty(root);
      return;
    }

    const note = root.createEl("p", { cls: "sauce-view-desc" });
    note.setText(`${points.length} geo-coded entities (click a dot to open)`);

    // Legend so the dot colors are self-explanatory.
    const legend = root.createDiv({ cls: "sauce-map-legend" });
    const person = legend.createSpan({ cls: "sauce-map-legend-item" });
    person.createSpan({ cls: "sauce-map-dot sauce-map-dot--person" });
    person.createSpan({ text: "Person" });
    const org = legend.createSpan({ cls: "sauce-map-legend-item" });
    org.createSpan({ cls: "sauce-map-dot sauce-map-dot--org" });
    org.createSpan({ text: "Org" });

    this.canvas = root.createEl("canvas", {
      cls: "sauce-map-canvas",
    }) as HTMLCanvasElement;
    this.help.register(
      this.canvas,
      "Map canvas",
      "Each dot is a person or organization with lat/lon frontmatter; click one to open its note.",
    );
    this.canvas.width = this.canvas.offsetWidth || 800;
    this.canvas.height = 500;
    this.canvas.onclick = (ev) => {
      if (!this.canvas) return;
      const rect = this.canvas.getBoundingClientRect();
      const x = ev.clientX - rect.left;
      const y = ev.clientY - rect.top;
      const hit = this.plots.find((p) => Math.hypot(p.x - x, p.y - y) < 8);
      if (hit) this.openPath(hit.path);
    };
    this.draw(points);
  }

  override async onClose(): Promise<void> {
    this.canvas = null;
    this.plots = [];
  }

  /** Helpful, non-dead empty state: explains what the view needs and how to
   *  get there, instead of an "implementation pending" stub. */
  private renderEmpty(root: HTMLElement): void {
    const empty = root.createDiv({ cls: "sauce-empty-state" });
    empty.createEl("h4", {
      cls: "sauce-empty-state-title",
      text: "No geo-coded entities yet",
    });
    empty.createEl("p", {
      cls: "sauce-empty-state-body",
      text:
        "This map plots any person or org note that has numeric `lat` and `lon` " +
        "frontmatter. None of your entities carry coordinates yet.",
    });
    empty.createEl("p", {
      cls: "sauce-empty-state-body",
      text:
        'Add `lat:` and `lon:` to a note, or run the "Geocode Current Note" ' +
        "command on an open person/org, then reopen this view.",
    });
    this.help.register(
      empty,
      "Map",
      "Geo-coded people and orgs appear here as clickable dots once they have lat/lon frontmatter.",
    );
  }

  /** Resolve a vault `path` and open it via a real TFile (never `openLinkText`,
   *  which can create a phantom tab for a stale path). Mirrors CalendarView. */
  private openPath(path: string): void {
    openVaultPath(this.plugin.app, path);
  }

  private collect(): Plot[] {
    const out: Plot[] = [];
    const push = (
      basename: string,
      path: string,
      fm: Record<string, unknown>,
      kind: "person" | "org",
    ): void => {
      const lat = Number(fm.lat);
      const lon = Number(fm.lon);
      if (Number.isFinite(lat) && Number.isFinite(lon))
        out.push({ x: 0, y: 0, basename, path, lat, lon, kind });
    };
    for (const p of this.plugin.entityService.allPeople())
      push(p.file.basename, p.file.path, p.frontmatter, "person");
    for (const o of this.plugin.entityService.allOrgs())
      push(o.file.basename, o.file.path, o.frontmatter, "org");
    return out;
  }

  private draw(points: Plot[]): void {
    if (!this.canvas) return;
    const ctx = this.canvas.getContext("2d");
    if (!ctx) return;
    const w = this.canvas.width;
    const h = this.canvas.height;
    ctx.clearRect(0, 0, w, h);

    const lats = points.map((p) => p.lat);
    const lons = points.map((p) => p.lon);
    let minLat = Math.min(...lats);
    let maxLat = Math.max(...lats);
    let minLon = Math.min(...lons);
    let maxLon = Math.max(...lons);
    // Pad so single-point / colinear sets still render with breathing room.
    if (maxLat - minLat < 0.001) {
      maxLat += 0.05;
      minLat -= 0.05;
    }
    if (maxLon - minLon < 0.001) {
      maxLon += 0.05;
      minLon -= 0.05;
    }
    const pad = 30;

    // Reference grid.
    ctx.strokeStyle = "rgba(120,120,120,0.15)";
    ctx.lineWidth = 1;
    for (let i = 0; i < 5; i++) {
      const y = pad + (i / 4) * (h - 2 * pad);
      ctx.beginPath();
      ctx.moveTo(pad, y);
      ctx.lineTo(w - pad, y);
      ctx.stroke();
      const x = pad + (i / 4) * (w - 2 * pad);
      ctx.beginPath();
      ctx.moveTo(x, pad);
      ctx.lineTo(x, h - pad);
      ctx.stroke();
    }

    this.plots = points.map((p) => {
      const x = pad + ((p.lon - minLon) / (maxLon - minLon)) * (w - 2 * pad);
      const y =
        pad + (1 - (p.lat - minLat) / (maxLat - minLat)) * (h - 2 * pad);
      return { ...p, x, y };
    });

    for (const pl of this.plots) {
      ctx.fillStyle =
        pl.kind === "org" ? "rgba(220,160,80,0.85)" : "rgba(80,160,220,0.85)";
      ctx.beginPath();
      ctx.arc(pl.x, pl.y, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "var(--text-normal)";
      ctx.font = "10px sans-serif";
      ctx.fillText(pl.basename, pl.x + 8, pl.y + 4);
    }
  }
}
