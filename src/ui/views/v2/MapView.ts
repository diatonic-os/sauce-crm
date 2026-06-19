// SPEC §28 — Real map view. Plots vault entities with lat/lon on a canvas with
// equirectangular projection (good-enough for personal-graph scale). Click → modal.

import { ItemView, WorkspaceLeaf, Notice } from "obsidian";
import type SauceGraphPlugin from "../../../main";
import { type ViewTypeId, asViewTypeId } from "@/types/brands";
import { SauceViewHelp } from "../../components/v2/SauceViewHelp";

export const VIEW_MAP: ViewTypeId = asViewTypeId("sauce-map");

interface Plot {
  x: number;
  y: number;
  basename: string;
  lat: number;
  lon: number;
  kind: "person" | "org";
}

export class MapView extends ItemView {
  private canvas!: HTMLCanvasElement;
  private plots: Plot[] = [];
  private help!: SauceViewHelp;

  constructor(
    leaf: WorkspaceLeaf,
    public plugin: SauceGraphPlugin,
  ) {
    super(leaf);
  }
  getViewType(): string {
    return VIEW_MAP;
  }
  getDisplayText(): string {
    return "Sauce: Map";
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
    root.createEl("h2", { text: "Map" });
    const note = root.createEl("p", { cls: "sauce-view-desc" });

    this.canvas = root.createEl("canvas", {
      cls: "sauce-map-canvas",
    }) as HTMLCanvasElement;
    this.help.register(
      this.canvas,
      "Map canvas",
      "Each dot is a person or organization with coordinates; click one to open its note.",
    );
    this.canvas.width = this.canvas.offsetWidth || 800;
    this.canvas.height = 500;
    this.canvas.onclick = (ev) => {
      const rect = this.canvas.getBoundingClientRect();
      const x = ev.clientX - rect.left,
        y = ev.clientY - rect.top;
      const hit = this.plots.find((p) => Math.hypot(p.x - x, p.y - y) < 8);
      if (hit) this.openEntity(hit.basename);
    };

    const points = this.collect();
    if (points.length === 0) {
      note.setText(
        "No entities with lat/lon yet. Use the geocode skill on a person/org to populate.",
      );
      return;
    }
    note.setText(`${points.length} geo-coded entities (click to open)`);
    this.draw(points);
  }

  override async onClose(): Promise<void> {}

  private collect(): Plot[] {
    const out: Plot[] = [];
    for (const p of this.plugin.entityService.allPeople()) {
      const lat = Number(p.frontmatter.lat),
        lon = Number(p.frontmatter.lon);
      if (Number.isFinite(lat) && Number.isFinite(lon))
        out.push({
          x: 0,
          y: 0,
          basename: p.file.basename,
          lat,
          lon,
          kind: "person",
        });
    }
    for (const o of this.plugin.entityService.allOrgs()) {
      const lat = Number(o.frontmatter.lat),
        lon = Number(o.frontmatter.lon);
      if (Number.isFinite(lat) && Number.isFinite(lon))
        out.push({
          x: 0,
          y: 0,
          basename: o.file.basename,
          lat,
          lon,
          kind: "org",
        });
    }
    return out;
  }

  private draw(points: Plot[]): void {
    const ctx = this.canvas.getContext("2d");
    if (!ctx) return;
    const w = this.canvas.width,
      h = this.canvas.height;
    ctx.clearRect(0, 0, w, h);
    const lats = points.map((p) => p.lat);
    const lons = points.map((p) => p.lon);
    let minLat = Math.min(...lats),
      maxLat = Math.max(...lats);
    let minLon = Math.min(...lons),
      maxLon = Math.max(...lons);
    // pad so single-point sets render
    if (maxLat - minLat < 0.001) {
      maxLat += 0.05;
      minLat -= 0.05;
    }
    if (maxLon - minLon < 0.001) {
      maxLon += 0.05;
      minLon -= 0.05;
    }
    const pad = 30;

    // grid
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

  private openEntity(basename: string): void {
    const f = this.app.metadataCache.getFirstLinkpathDest(basename, "");
    if (!f) {
      new Notice(`could not resolve ${basename}`);
      return;
    }
    void this.app.workspace.openLinkText(basename, "", false);
  }
}
