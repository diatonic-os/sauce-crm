// View type identifiers + base helper. We export all 8 views from this barrel
// to keep main.ts wiring concise.

import { ItemView, WorkspaceLeaf, TFile } from "obsidian";
import type SauceGraphPlugin from "../../main";
import { Person } from "../../domain/Person";
import { Org } from "../../domain/Org";
import { computeCompatibleSet } from "../../compat/CompatibleSet";
import { todayIso, parseIsoSafe, daysBetween } from "../../util/DateUtil";

export const VIEW_DASHBOARD  = "sauce-dashboard";
export const VIEW_PIPELINE   = "sauce-pipeline";
export const VIEW_GRAPH      = "sauce-graph-view";
export const VIEW_COMPAT     = "sauce-compat";
export const VIEW_HEATMAP    = "sauce-heatmap";
export const VIEW_HIERARCHY  = "sauce-hierarchy";
export const VIEW_OVERDUE    = "sauce-overdue";
export const VIEW_PARENT     = "sauce-parent-dashboard";

abstract class BaseView extends ItemView {
  constructor(leaf: WorkspaceLeaf, public plugin: SauceGraphPlugin) { super(leaf); }
  getIcon(): string { return "network"; }
  protected openModalFor(file: TFile): void {
    const fm = this.app.metadataCache.getFileCache(file)?.frontmatter ?? {};
    if (fm.type === "warm-contact") {
      void import("../modals/PersonModal").then(({ PersonModal }) => new PersonModal(this.app, this.plugin, file).open());
    } else if (fm.type === "org" || fm.type === "subsidiary") {
      void import("../modals/OrgModal").then(({ OrgModal }) => new OrgModal(this.app, this.plugin, file).open());
    }
  }
}

export class DashboardView extends BaseView {
  getViewType(): string { return VIEW_DASHBOARD; }
  getDisplayText(): string { return "Sauce: Dashboard"; }
  async onOpen(): Promise<void> {
    const root = this.contentEl; root.empty(); root.addClass("sauce-view");
    root.createEl("h2", { text: "Sauce — Dashboard" });
    const kpis = root.createDiv({ cls: "sauce-view-kpis" });
    const people = this.plugin.entityService.allPeople();
    const orgs = this.plugin.entityService.allOrgs();
    const touches = this.plugin.entityService.allTouches();
    const addenda = this.plugin.entityService.allAddenda();
    const prospects = people.filter((e) => (e.frontmatter.roles ?? []).includes("prospect")).length;
    const overdue = people.filter((e) => e instanceof Person && (e as Person).isOverdue()).length;
    for (const [label, value] of [["People", people.length], ["Orgs", orgs.length], ["Touches", touches.length], ["Addenda", addenda.length], ["Prospects", prospects], ["Overdue", overdue]] as const) {
      const k = kpis.createDiv({ cls: "sauce-kpi" });
      k.createDiv({ cls: "label", text: String(label) });
      k.createDiv({ cls: "value", text: String(value) });
    }
    root.createEl("h3", { text: "Recent touches" });
    const recent = touches.slice().sort((a, b) => (b.frontmatter.date ?? "").localeCompare(a.frontmatter.date ?? "")).slice(0, 10);
    const ul = root.createEl("ul");
    for (const t of recent) ul.createEl("li", { text: `${t.frontmatter.date}  ·  ${t.frontmatter.contact}  ·  ${t.frontmatter.channel}` });
  }
  async onClose(): Promise<void> {}
}

export class PipelineKanbanView extends BaseView {
  getViewType(): string { return VIEW_PIPELINE; }
  getDisplayText(): string { return "Sauce: Pipeline"; }
  async onOpen(): Promise<void> {
    const root = this.contentEl; root.empty(); root.addClass("sauce-view");
    root.createEl("h2", { text: "Pipeline" });
    const lanes = ["prospect","mentor","advisor","connector","peer-founder","community"];
    const board = root.createDiv({ cls: "sauce-kanban" });
    for (const lane of lanes) {
      const col = board.createDiv({ cls: "sauce-kanban-col" });
      col.createEl("h3", { text: lane });
      for (const e of this.plugin.entityService.allPeople()) {
        const roles = e.frontmatter.roles ?? [];
        if (!roles.includes(lane)) continue;
        const card = col.createDiv({ cls: "sauce-kanban-card", text: e.file.basename });
        card.onclick = () => this.openModalFor(e.file);
      }
    }
  }
  async onClose(): Promise<void> {}
}

export class TypedEdgeGraphView extends BaseView {
  getViewType(): string { return VIEW_GRAPH; }
  getDisplayText(): string { return "Sauce: Typed-Edge Graph"; }
  async onOpen(): Promise<void> {
    const root = this.contentEl; root.empty(); root.addClass("sauce-view");
    root.createEl("h2", { text: "Typed-Edge Graph" });
    const canvas = root.createEl("canvas", { cls: "sauce-graph-canvas" }) as HTMLCanvasElement;
    const w = canvas.width = canvas.offsetWidth || 800;
    const h = canvas.height = 600;
    const ctx = canvas.getContext("2d"); if (!ctx) return;
    const nodes = [
      ...this.plugin.entityService.allPeople(),
      ...this.plugin.entityService.allOrgs(),
    ];
    const positions = new Map<string, [number, number]>();
    nodes.forEach((n, i) => {
      const angle = (i / nodes.length) * Math.PI * 2;
      positions.set(n.file.basename, [w/2 + Math.cos(angle) * (w/2 - 40), h/2 + Math.sin(angle) * (h/2 - 40)]);
    });
    ctx.strokeStyle = "rgba(120,180,220,0.4)";
    ctx.lineWidth = 1;
    for (const n of nodes) {
      const src = positions.get(n.file.basename); if (!src) continue;
      for (const edge of ["knows","worked_with","parent"]) {
        const v = n.frontmatter[edge];
        const list = Array.isArray(v) ? v : v ? [v] : [];
        for (const link of list) {
          const target = String(link).replace(/\[\[|\]\]/g, "").split("|")[0];
          const dst = positions.get(target); if (!dst) continue;
          ctx.beginPath(); ctx.moveTo(src[0], src[1]); ctx.lineTo(dst[0], dst[1]); ctx.stroke();
        }
      }
    }
    for (const n of nodes) {
      const p = positions.get(n.file.basename); if (!p) continue;
      ctx.fillStyle = n instanceof Org ? "rgba(220,160,80,0.8)" : "rgba(80,160,220,0.8)";
      ctx.beginPath(); ctx.arc(p[0], p[1], 6, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "var(--text-normal)";
      ctx.font = "10px sans-serif";
      ctx.fillText(n.file.basename, p[0] + 8, p[1] + 4);
    }
  }
  async onClose(): Promise<void> {}
}

export class CompatibilityMatrixView extends BaseView {
  getViewType(): string { return VIEW_COMPAT; }
  getDisplayText(): string { return "Sauce: Compatibility Matrix"; }
  async onOpen(): Promise<void> {
    const root = this.contentEl; root.empty(); root.addClass("sauce-view");
    root.createEl("h2", { text: "Compatibility Matrix (top 20)" });
    const people = this.plugin.entityService.allPeople().slice(0, 20);
    const cfg = this.plugin.settings.compat_config;
    const grid = root.createDiv({ cls: "sauce-matrix" });
    grid.style.gridTemplateColumns = `repeat(${people.length + 1}, 24px)`;
    grid.createDiv({ cls: "sauce-matrix-cell" });
    for (const p of people) grid.createDiv({ cls: "sauce-matrix-cell", text: p.file.basename.slice(0,2) });
    for (const a of people) {
      grid.createDiv({ cls: "sauce-matrix-cell", text: a.file.basename.slice(0,2) });
      for (const b of people) {
        const cms = computeCompatibleSet(a.frontmatter, b.frontmatter, cfg.fields);
        const v = Math.round(cms.density * 100);
        const cell = grid.createDiv({ cls: "sauce-matrix-cell", text: String(v) });
        const op = Math.min(1, cms.density * 1.5).toFixed(2);
        cell.style.background = `rgba(80,160,220,${op})`;
      }
    }
  }
  async onClose(): Promise<void> {}
}

export class TouchHeatmapView extends BaseView {
  getViewType(): string { return VIEW_HEATMAP; }
  getDisplayText(): string { return "Sauce: Touch Heatmap"; }
  async onOpen(): Promise<void> {
    const root = this.contentEl; root.empty(); root.addClass("sauce-view");
    root.createEl("h2", { text: "Touch Heatmap (52 weeks)" });
    const counts = new Map<string, number>();
    for (const t of this.plugin.entityService.allTouches()) {
      const d = t.frontmatter.date; if (!d) continue;
      counts.set(d, (counts.get(d) ?? 0) + 1);
    }
    const grid = root.createDiv({ cls: "sauce-heatmap" });
    const today = new Date();
    for (let i = 365; i >= 0; i--) {
      const d = new Date(today); d.setDate(d.getDate() - i);
      const iso = d.toISOString().slice(0, 10);
      const n = counts.get(iso) ?? 0;
      const level = n === 0 ? "" : n === 1 ? "l1" : n === 2 ? "l2" : n < 5 ? "l3" : "l4";
      const cell = grid.createDiv({ cls: `sauce-heatmap-cell ${level}` });
      cell.setAttribute("title", `${iso}: ${n}`);
    }
  }
  async onClose(): Promise<void> {}
}

export class HierarchyTreeView extends BaseView {
  getViewType(): string { return VIEW_HIERARCHY; }
  getDisplayText(): string { return "Sauce: Hierarchy"; }
  async onOpen(): Promise<void> {
    const root = this.contentEl; root.empty(); root.addClass("sauce-view");
    root.createEl("h2", { text: "Org Hierarchy" });
    const orgs = this.plugin.entityService.allOrgs();
    const byName = new Map(orgs.map((o) => [o.file.basename, o]));
    const children = new Map<string, string[]>();
    const tops: string[] = [];
    for (const o of orgs) {
      const p = String(o.frontmatter.parent ?? "").replace(/\[\[|\]\]/g, "").split("|")[0];
      if (p && byName.has(p)) {
        if (!children.has(p)) children.set(p, []);
        children.get(p)!.push(o.file.basename);
      } else tops.push(o.file.basename);
    }
    const render = (name: string, container: HTMLElement) => {
      const node = container.createDiv({ cls: "sauce-tree-node", text: name });
      const org = byName.get(name);
      if (org) node.onclick = () => this.openModalFor(org.file);
      const kids = children.get(name) ?? [];
      if (kids.length === 0) return;
      const sub = container.createDiv({ cls: "sauce-tree-children" });
      for (const k of kids) render(k, sub);
    };
    for (const t of tops) render(t, root);
  }
  async onClose(): Promise<void> {}
}

export class OverdueQueueView extends BaseView {
  getViewType(): string { return VIEW_OVERDUE; }
  getDisplayText(): string { return "Sauce: Overdue Queue"; }
  async onOpen(): Promise<void> {
    const root = this.contentEl; root.empty(); root.addClass("sauce-view");
    root.createEl("h2", { text: "Overdue Queue" });
    const today = new Date();
    const people = this.plugin.entityService.allPeople()
      .filter((e) => e instanceof Person && (e as Person).isOverdue(today))
      .map((e) => {
        const p = e as Person;
        const last = parseIsoSafe(p.last_touch);
        const days = last ? daysBetween(last, today) : 9999;
        const priority = p.closeness * Math.log(1 + days);
        return { person: p, days, priority };
      })
      .sort((a, b) => b.priority - a.priority);
    for (const row of people) {
      const r = root.createDiv({ cls: "sauce-overdue-row" });
      r.createDiv({ text: row.person.file.basename });
      r.createDiv({ cls: "priority", text: `${row.days}d · ${row.priority.toFixed(1)}` });
      r.onclick = () => this.openModalFor(row.person.file);
    }
  }
  async onClose(): Promise<void> {}
}

export class ParentDashboardView extends BaseView {
  getViewType(): string { return VIEW_PARENT; }
  getDisplayText(): string { return "Sauce: Parent Vault Dashboard"; }
  async onOpen(): Promise<void> {
    const root = this.contentEl; root.empty(); root.addClass("sauce-view");
    root.createEl("h2", { text: "ParentVault Dashboard" });
    const pv = this.plugin.registry.loadParentVault();
    if (!pv) { root.createEl("p", { text: "No PARENT-VAULT.md found in this vault root." }); return; }
    root.createEl("p", { text: `Vault id: ${pv.vault_id} · policy: ${pv.federation_policy.validation_gate}` });
    const subs = this.plugin.registry.listSubVaults();
    root.createEl("h3", { text: `Registered SubVaults (${subs.length})` });
    const ul = root.createEl("ul");
    for (const sv of subs) {
      const li = ul.createEl("li");
      li.createSpan({ text: `${sv.vault_id} → ${sv.path}` });
      li.createSpan({ cls: "sauce-fed-badge", text: sv.enabled ? "enabled" : "disabled" });
    }
    root.createEl("p", { text: `Generated ${todayIso()}` });
  }
  async onClose(): Promise<void> {}
}
