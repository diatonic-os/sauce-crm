// View type identifiers + base helper. We export all 8 views from this barrel
// to keep main.ts wiring concise.

import { ItemView, WorkspaceLeaf, TFile } from "obsidian";
import type SauceGraphPlugin from "../../main";
import { Entity } from "../../domain/Entity";
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
    } else {
      void this.app.workspace.openLinkText(file.path, "", false);
    }
  }
}

export class DashboardView extends BaseView {
  getViewType(): string { return VIEW_DASHBOARD; }
  getDisplayText(): string { return "Sauce: Dashboard"; }
  async onOpen(): Promise<void> {
    const root = this.contentEl; root.empty(); root.addClass("sauce-view");
    root.createEl("h2", { text: "Sauce CRM Command Center" });
    const people = this.plugin.entityService.allPeople();
    const orgs = this.plugin.entityService.allOrgs();
    const touches = this.plugin.entityService.allTouches();
    const addenda = this.plugin.entityService.allAddenda();
    const notes = this.plugin.entityService.allNotes();
    const ideas = this.plugin.entityService.allIdeas();
    const observations = this.plugin.entityService.allObservations();
    const tasks = this.plugin.entityService.allTasks();
    const events = this.plugin.entityService.allEvents();
    const ledger = this.plugin.entityService.allLedgerEntries();
    const deals = this.plugin.entityService.allPipelineDeals();
    const prospects = people.filter((e) => (e.frontmatter.roles ?? []).includes("prospect")).length;
    const overdue = people.filter((e) => e instanceof Person && (e as Person).isOverdue()).length;

    const kpis = root.createDiv({ cls: "sauce-view-kpis sauce-dashboard-grid" });
    for (const [label, value, tone] of [
      ["People", people.length, "blue"], ["Orgs", orgs.length, "gold"],
      ["Touches", touches.length, "green"], ["Notes", notes.length, "blue"],
      ["Ideas", ideas.length, "purple"], ["Observations", observations.length, "cyan"],
      ["Tasks", tasks.length, "orange"], ["Events", events.length, "green"],
      ["Ledger", ledger.length, "red"], ["Pipeline", deals.length, "gold"],
      ["Prospects", prospects, "purple"], ["Overdue", overdue, overdue ? "red" : "green"],
      ["Addenda", addenda.length, "cyan"],
    ] as const) {
      const k = kpis.createDiv({ cls: `sauce-kpi sauce-kpi--${tone}` });
      k.createDiv({ cls: "label", text: String(label) });
      k.createDiv({ cls: "value", text: String(value) });
    }

    const top = root.createDiv({ cls: "sauce-dashboard-columns" });
    const morning = top.createDiv({ cls: "sauce-section" });
    morning.createEl("h3", { text: "Copilot Feed" });
    for (const line of this.copilotFeed(people, tasks, events)) {
      const row = morning.createDiv({ cls: "sauce-feed-row" });
      row.createSpan({ cls: "sauce-feed-dot" });
      row.createSpan({ text: line });
    }

    const chart = top.createDiv({ cls: "sauce-section" });
    chart.createEl("h3", { text: "Touch Velocity" });
    this.renderMonthlyBars(chart, touches.map((t) => String(t.frontmatter.date ?? "")));

    const recent = root.createDiv({ cls: "sauce-dashboard-columns" });
    this.renderListCard(recent, "Recent touches", touches
      .slice().sort((a, b) => String(b.frontmatter.date ?? "").localeCompare(String(a.frontmatter.date ?? "")))
      .slice(0, 8)
      .map((t) => ({
        title: `${String(t.frontmatter.contact ?? t.file.basename)}`,
        meta: `${String(t.frontmatter.date ?? "?")} - ${String(t.frontmatter.channel ?? "?")}`,
        file: t.file,
      })));
    this.renderListCard(recent, "Next tasks", tasks
      .slice().sort((a, b) => String(a.frontmatter.due ?? "9999-99-99").localeCompare(String(b.frontmatter.due ?? "9999-99-99")))
      .slice(0, 8)
      .map((t) => ({
        title: String(t.frontmatter.title ?? t.file.basename),
        meta: `${String(t.frontmatter.status ?? "todo")} - due ${String(t.frontmatter.due ?? "none")}`,
        file: t.file,
      })));

    const second = root.createDiv({ cls: "sauce-dashboard-columns" });
    this.renderListCard(second, "Ideas to shape", ideas.slice(0, 8).map((i) => ({
      title: String(i.frontmatter.title ?? i.file.basename),
      meta: `${String(i.frontmatter.stage ?? "seed")} - ${String(i.frontmatter.next_action ?? "no next action")}`,
      file: i.file,
    })));
    this.renderListCard(second, "Upcoming events", events
      .slice().sort((a, b) => String(a.frontmatter.date ?? "").localeCompare(String(b.frontmatter.date ?? "")))
      .slice(0, 8)
      .map((e) => ({
        title: String(e.frontmatter.title ?? e.file.basename),
        meta: `${String(e.frontmatter.date ?? "?")} ${String(e.frontmatter.start ?? "")}`,
        file: e.file,
      })));
  }
  async onClose(): Promise<void> {}

  private copilotFeed(people: Entity[], tasks: Entity[], events: Entity[]): string[] {
    const overdue = people.filter((e) => e instanceof Person && (e as Person).isOverdue()).slice(0, 3);
    const nextTasks = tasks
      .filter((t) => String(t.frontmatter.status ?? "todo") !== "done")
      .slice(0, 3);
    const upcomingEvents = events
      .filter((e) => String(e.frontmatter.date ?? "") >= todayIso())
      .slice(0, 2);
    const out: string[] = [];
    for (const p of overdue) out.push(`Follow up with ${p.file.basename}; cadence is overdue.`);
    for (const t of nextTasks) out.push(`Task pending: ${String(t.frontmatter.title ?? t.file.basename)}.`);
    for (const e of upcomingEvents) out.push(`Prepare context for ${String(e.frontmatter.title ?? e.file.basename)}.`);
    if (out.length === 0) out.push("No immediate relationship actions. Capture a note, touch, or idea to enrich the graph.");
    return out;
  }

  private renderMonthlyBars(parent: HTMLElement, dates: string[]): void {
    const buckets = new Map<string, number>();
    for (const d of dates) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) continue;
      const m = d.slice(0, 7);
      buckets.set(m, (buckets.get(m) ?? 0) + 1);
    }
    const months: string[] = [];
    const now = new Date();
    for (let i = 11; i >= 0; i--) {
      const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
      months.push(d.toISOString().slice(0, 7));
    }
    const max = Math.max(1, ...months.map((m) => buckets.get(m) ?? 0));
    const bars = parent.createDiv({ cls: "sauce-bar-chart" });
    for (const m of months) {
      const n = buckets.get(m) ?? 0;
      const bar = bars.createDiv({ cls: "sauce-bar" });
      bar.style.height = `${Math.max(8, Math.round((n / max) * 120))}px`;
      bar.setAttribute("title", `${m}: ${n}`);
      bar.createSpan({ text: String(n) });
      bars.createDiv({ cls: "sauce-bar-label", text: m.slice(5) });
    }
  }

  private renderListCard(parent: HTMLElement, title: string, rows: Array<{ title: string; meta: string; file: TFile }>): void {
    const card = parent.createDiv({ cls: "sauce-section" });
    card.createEl("h3", { text: title });
    if (rows.length === 0) {
      card.createEl("p", { cls: "sauce-field-help", text: "No records yet." });
      return;
    }
    for (const r of rows) {
      const row = card.createDiv({ cls: "sauce-list-row" });
      row.createDiv({ cls: "sauce-list-title", text: r.title });
      row.createDiv({ cls: "sauce-card-meta", text: r.meta });
      row.onclick = () => this.openModalFor(r.file);
    }
  }
}

export class PipelineKanbanView extends BaseView {
  getViewType(): string { return VIEW_PIPELINE; }
  getDisplayText(): string { return "Sauce: Pipeline"; }
  async onOpen(): Promise<void> {
    const root = this.contentEl; root.empty(); root.addClass("sauce-view");
    root.createEl("h2", { text: "Pipeline" });
    const lanes = ["prospect","first-touch","discovery","proposal","closed-won","closed-lost"];
    const board = root.createDiv({ cls: "sauce-kanban" });
    for (const lane of lanes) {
      const col = board.createDiv({ cls: "sauce-kanban-col" });
      col.createEl("h3", { text: lane });
      for (const deal of this.plugin.entityService.allPipelineDeals()) {
        if (String(deal.frontmatter.stage ?? "prospect") !== lane) continue;
        const card = col.createDiv({ cls: "sauce-kanban-card" });
        card.createDiv({ cls: "sauce-card-title", text: String(deal.frontmatter.title ?? deal.file.basename) });
        card.createDiv({ cls: "sauce-card-meta", text: `${String(deal.frontmatter.org ?? deal.frontmatter.contact ?? "unlinked")} - ${String(deal.frontmatter.value ?? "no value")}` });
        card.onclick = () => this.openModalFor(deal.file);
      }
      for (const e of this.plugin.entityService.allPeople()) {
        const roles = e.frontmatter.roles ?? [];
        if (lane !== "prospect" || !roles.includes("prospect")) continue;
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
