// View type identifiers + base helper. We export all 8 views from this barrel
// to keep main.ts wiring concise.

import { ItemView, WorkspaceLeaf, TFile, setIcon } from "obsidian";
import { type ViewTypeId, asViewTypeId } from "@/types/brands";
import type SauceGraphPlugin from "../../main";
import { Entity } from "../../domain/Entity";
import { Person } from "../../domain/Person";
import { Org } from "../../domain/Org";
import { computeCompatibleSet } from "../../compat/CompatibleSet";
import { todayIso, parseIsoSafe, daysBetween } from "../../util/DateUtil";
import {
  GraphAtlasService,
  type GraphNode,
  type GraphEdge,
} from "../../services/GraphAtlasService";

export const VIEW_DASHBOARD: ViewTypeId = asViewTypeId("sauce-dashboard");
export const VIEW_PIPELINE: ViewTypeId = asViewTypeId("sauce-pipeline");
export const VIEW_GRAPH: ViewTypeId = asViewTypeId("sauce-graph-view");
export const VIEW_COMPAT: ViewTypeId = asViewTypeId("sauce-compat");
export const VIEW_HEATMAP: ViewTypeId = asViewTypeId("sauce-heatmap");
export const VIEW_HIERARCHY: ViewTypeId = asViewTypeId("sauce-hierarchy");
export const VIEW_OVERDUE: ViewTypeId = asViewTypeId("sauce-overdue");
export const VIEW_PARENT: ViewTypeId = asViewTypeId("sauce-parent-dashboard");

abstract class BaseView extends ItemView {
  constructor(
    leaf: WorkspaceLeaf,
    public plugin: SauceGraphPlugin,
  ) {
    super(leaf);
  }
  override getIcon(): string {
    return "network";
  }
  protected openModalFor(file: TFile): void {
    const fm = this.app.metadataCache.getFileCache(file)?.frontmatter ?? {};
    if (fm.type === "warm-contact") {
      void import("../modals/PersonModal").then(({ PersonModal }) =>
        new PersonModal(this.app, this.plugin, file).open(),
      );
    } else if (fm.type === "org" || fm.type === "subsidiary") {
      void import("../modals/OrgModal").then(({ OrgModal }) =>
        new OrgModal(this.app, this.plugin, file).open(),
      );
    } else {
      void this.app.workspace.openLinkText(file.path, "", false);
    }
  }
}

export class DashboardView extends BaseView {
  getViewType(): string {
    return VIEW_DASHBOARD;
  }
  getDisplayText(): string {
    return "Sauce: Dashboard";
  }
  override async onOpen(): Promise<void> {
    const root = this.contentEl;
    root.empty();
    root.addClass("sauce-view");
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
    const prospects = people.filter((e) =>
      (e.frontmatter.roles ?? []).includes("prospect"),
    ).length;
    const overdue = people.filter(
      (e) => e instanceof Person && (e as Person).isOverdue(),
    ).length;

    const kpis = root.createDiv({
      cls: "sauce-view-kpis sauce-dashboard-grid",
    });
    for (const [label, value, tone] of [
      ["People", people.length, "blue"],
      ["Orgs", orgs.length, "gold"],
      ["Touches", touches.length, "green"],
      ["Notes", notes.length, "blue"],
      ["Ideas", ideas.length, "purple"],
      ["Observations", observations.length, "cyan"],
      ["Tasks", tasks.length, "orange"],
      ["Events", events.length, "green"],
      ["Ledger", ledger.length, "red"],
      ["Pipeline", deals.length, "gold"],
      ["Prospects", prospects, "purple"],
      ["Overdue", overdue, overdue ? "red" : "green"],
      ["Addenda", addenda.length, "cyan"],
    ] as const) {
      const k = kpis.createDiv({ cls: `sauce-kpi sauce-kpi--${tone}` });
      k.createDiv({ cls: "label", text: String(label) });
      k.createDiv({ cls: "value", text: String(value) });
    }

    const top = root.createDiv({ cls: "sauce-dashboard-columns" });
    const morning = top.createDiv({ cls: "sauce-section" });
    morning.createEl("h3", { text: "SauceBot Feed" });
    for (const line of this.copilotFeed(people, tasks, events)) {
      const row = morning.createDiv({ cls: "sauce-feed-row" });
      row.createSpan({ cls: "sauce-feed-dot" });
      row.createSpan({ text: line });
    }

    const chart = top.createDiv({ cls: "sauce-section" });
    chart.createEl("h3", { text: "Touch Velocity" });
    this.renderMonthlyBars(
      chart,
      touches.map((t) => String(t.frontmatter.date ?? "")),
    );

    const recent = root.createDiv({ cls: "sauce-dashboard-columns" });
    this.renderListCard(
      recent,
      "Recent touches",
      touches
        .slice()
        .sort((a, b) =>
          String(b.frontmatter.date ?? "").localeCompare(
            String(a.frontmatter.date ?? ""),
          ),
        )
        .slice(0, 8)
        .map((t) => ({
          title: `${String(t.frontmatter.contact ?? t.file.basename)}`,
          meta: `${String(t.frontmatter.date ?? "?")} - ${String(t.frontmatter.channel ?? "?")}`,
          file: t.file,
        })),
    );
    this.renderListCard(
      recent,
      "Next tasks",
      tasks
        .slice()
        .sort((a, b) =>
          String(a.frontmatter.due ?? "9999-99-99").localeCompare(
            String(b.frontmatter.due ?? "9999-99-99"),
          ),
        )
        .slice(0, 8)
        .map((t) => ({
          title: String(t.frontmatter.title ?? t.file.basename),
          meta: `${String(t.frontmatter.status ?? "todo")} - due ${String(t.frontmatter.due ?? "none")}`,
          file: t.file,
        })),
    );

    const second = root.createDiv({ cls: "sauce-dashboard-columns" });
    this.renderListCard(
      second,
      "Ideas to shape",
      ideas.slice(0, 8).map((i) => ({
        title: String(i.frontmatter.title ?? i.file.basename),
        meta: `${String(i.frontmatter.stage ?? "seed")} - ${String(i.frontmatter.next_action ?? "no next action")}`,
        file: i.file,
      })),
    );
    this.renderListCard(
      second,
      "Upcoming events",
      events
        .slice()
        .sort((a, b) =>
          String(a.frontmatter.date ?? "").localeCompare(
            String(b.frontmatter.date ?? ""),
          ),
        )
        .slice(0, 8)
        .map((e) => ({
          title: String(e.frontmatter.title ?? e.file.basename),
          meta: `${String(e.frontmatter.date ?? "?")} ${String(e.frontmatter.start ?? "")}`,
          file: e.file,
        })),
    );
  }
  override async onClose(): Promise<void> {}

  private copilotFeed(
    people: Entity[],
    tasks: Entity[],
    events: Entity[],
  ): string[] {
    const overdue = people
      .filter((e) => e instanceof Person && (e as Person).isOverdue())
      .slice(0, 3);
    const nextTasks = tasks
      .filter((t) => String(t.frontmatter.status ?? "todo") !== "done")
      .slice(0, 3);
    const upcomingEvents = events
      .filter((e) => String(e.frontmatter.date ?? "") >= todayIso())
      .slice(0, 2);
    const out: string[] = [];
    for (const p of overdue)
      out.push(`Follow up with ${p.file.basename}; cadence is overdue.`);
    for (const t of nextTasks)
      out.push(
        `Task pending: ${String(t.frontmatter.title ?? t.file.basename)}.`,
      );
    for (const e of upcomingEvents)
      out.push(
        `Prepare context for ${String(e.frontmatter.title ?? e.file.basename)}.`,
      );
    if (out.length === 0)
      out.push(
        "No immediate relationship actions. Capture a note, touch, or idea to enrich the graph.",
      );
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
      const d = new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1),
      );
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

  private renderListCard(
    parent: HTMLElement,
    title: string,
    rows: Array<{ title: string; meta: string; file: TFile }>,
  ): void {
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
  getViewType(): string {
    return VIEW_PIPELINE;
  }
  getDisplayText(): string {
    return "Sauce: Pipeline";
  }
  override async onOpen(): Promise<void> {
    const root = this.contentEl;
    root.empty();
    root.addClass("sauce-view");
    root.createEl("h2", { text: "Pipeline" });
    const lanes = [
      "prospect",
      "first-touch",
      "discovery",
      "proposal",
      "closed-won",
      "closed-lost",
    ];
    const board = root.createDiv({ cls: "sauce-kanban" });
    for (const lane of lanes) {
      const col = board.createDiv({ cls: "sauce-kanban-col" });
      col.createEl("h3", { text: lane });
      for (const deal of this.plugin.entityService.allPipelineDeals()) {
        if (String(deal.frontmatter.stage ?? "prospect") !== lane) continue;
        const card = col.createDiv({ cls: "sauce-kanban-card" });
        card.createDiv({
          cls: "sauce-card-title",
          text: String(deal.frontmatter.title ?? deal.file.basename),
        });
        card.createDiv({
          cls: "sauce-card-meta",
          text: `${String(deal.frontmatter.org ?? deal.frontmatter.contact ?? "unlinked")} - ${String(deal.frontmatter.value ?? "no value")}`,
        });
        card.onclick = () => this.openModalFor(deal.file);
      }
      for (const e of this.plugin.entityService.allPeople()) {
        const roles = e.frontmatter.roles ?? [];
        if (lane !== "prospect" || !roles.includes("prospect")) continue;
        const card = col.createDiv({
          cls: "sauce-kanban-card",
          text: e.file.basename,
        });
        card.onclick = () => this.openModalFor(e.file);
      }
    }
  }
  override async onClose(): Promise<void> {}
}

export class TypedEdgeGraphView extends BaseView {
  private shell: HTMLDivElement | null = null;
  private edgeCanvas: HTMLCanvasElement | null = null;
  private nodeLayer: HTMLDivElement | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private highlightId: string | null = null;
  private renderQueued = false;

  getViewType(): string {
    return VIEW_GRAPH;
  }
  getDisplayText(): string {
    return "Sauce: Relationship Atlas";
  }

  override async onOpen(): Promise<void> {
    const root = this.contentEl;
    root.empty();
    root.addClass("sauce-view");
    root.addClass("sauce-graph-view");
    root.createEl("h2", { text: "Relationship Atlas" });
    root.createEl("p", {
      cls: "sauce-view-desc",
      text: "Weighted nodes, geo pull, relationship force, and icon cards that reflow live when metadata changes.",
    });

    this.shell = root.createDiv({ cls: "sauce-graph-shell" });
    this.edgeCanvas = this.shell.createEl("canvas", {
      cls: "sauce-graph-canvas",
    }) as HTMLCanvasElement;
    this.nodeLayer = this.shell.createDiv({ cls: "sauce-graph-node-layer" });

    const legend = root.createDiv({ cls: "sauce-graph-legend" });
    for (const [label, icon, tone] of [
      ["People / Orgs", "sauce-person", "person"],
      ["Interactions", "sauce-touch", "touch"],
      ["Tasks / Ideas", "sauce-task", "task"],
      ["Geo nodes", "sauce-map", "geo"],
    ] as const) {
      const chip = legend.createDiv({
        cls: `sauce-graph-legend-chip sauce-graph-legend-chip--${tone}`,
      });
      const iconEl = chip.createSpan({ cls: "sauce-graph-legend-icon" });
      setIcon(iconEl, icon);
      chip.createSpan({ text: label });
    }

    this.resizeObserver = new ResizeObserver(() => this.scheduleRender());
    if (this.shell) this.resizeObserver.observe(this.shell);
    this.scheduleRender();
  }

  override async onClose(): Promise<void> {
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.highlightId = null;
    this.renderQueued = false;
    this.shell = null;
    this.edgeCanvas = null;
    this.nodeLayer = null;
  }

  private scheduleRender(): void {
    if (this.renderQueued) return;
    this.renderQueued = true;
    window.requestAnimationFrame(() => {
      this.renderQueued = false;
      void this.renderGraph();
    });
  }

  private async renderGraph(): Promise<void> {
    if (!this.edgeCanvas || !this.nodeLayer || !this.shell) return;
    const atlas = new GraphAtlasService(
      this.plugin.app,
      this.plugin.entityService,
    );
    const width = Math.max(960, this.shell.clientWidth || 0);
    const height = Math.max(680, this.shell.clientHeight || 0);
    const snapshot = atlas.snapshot({
      width,
      height,
      focusId: this.highlightId,
    });
    const canvas = this.edgeCanvas;
    canvas.width = Math.max(800, Math.floor(width));
    canvas.height = Math.max(600, Math.floor(height));
    const ctx = canvas.getContext("2d");
    if (ctx)
      this.drawEdges(
        ctx,
        canvas.width,
        canvas.height,
        snapshot.nodes,
        snapshot.edges,
      );
    this.drawNodes(snapshot.nodes, snapshot.edges);
  }

  private drawEdges(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    nodes: GraphNode[],
    edges: GraphEdge[],
  ): void {
    ctx.clearRect(0, 0, width, height);
    ctx.save();
    ctx.lineCap = "round";
    const nodeById = new Map(nodes.map((n) => [n.id, n]));
    const focus = this.highlightId
      ? (nodeById.get(this.highlightId) ?? null)
      : null;
    for (const edge of edges) {
      const source = nodeById.get(edge.source);
      const target = nodeById.get(edge.target);
      if (!source || !target) continue;
      const connected =
        !focus || source.id === focus.id || target.id === focus.id;
      const alpha = connected ? 0.72 : 0.14;
      ctx.beginPath();
      ctx.moveTo(source.x, source.y);
      const midX = (source.x + target.x) / 2;
      const midY = (source.y + target.y) / 2;
      const bend = clamp(edge.weight * 8, 8, 28);
      const dx = target.x - source.x;
      const dy = target.y - source.y;
      const dist = Math.hypot(dx, dy) || 1;
      const nx = -dy / dist;
      const ny = dx / dist;
      ctx.quadraticCurveTo(
        midX + nx * bend,
        midY + ny * bend,
        target.x,
        target.y,
      );
      ctx.strokeStyle = withAlpha(edge.color, alpha);
      ctx.lineWidth = clamp(edge.weight, 0.8, 5.5);
      ctx.stroke();

      if (edge.directed) {
        const px = target.x - (dx / dist) * (target.radius + 8);
        const py = target.y - (dy / dist) * (target.radius + 8);
        ctx.beginPath();
        ctx.arc(px, py, 2.4, 0, Math.PI * 2);
        ctx.fillStyle = withAlpha(edge.color, alpha);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  private drawNodes(nodes: GraphNode[], edges: GraphEdge[]): void {
    if (!this.nodeLayer) return;
    this.nodeLayer.empty();
    const edgeNeighbors = new Map<string, Set<string>>();
    for (const edge of edges) {
      if (!edgeNeighbors.has(edge.source))
        edgeNeighbors.set(edge.source, new Set());
      if (!edgeNeighbors.has(edge.target))
        edgeNeighbors.set(edge.target, new Set());
      edgeNeighbors.get(edge.source)!.add(edge.target);
      edgeNeighbors.get(edge.target)!.add(edge.source);
    }
    const focusNeighbors = this.highlightId
      ? new Set([
          this.highlightId,
          ...(edgeNeighbors.get(this.highlightId) ?? []),
        ])
      : null;
    for (const node of nodes) {
      const btn = this.nodeLayer.createEl("button", {
        cls: `sauce-graph-node sauce-graph-node--${node.kind}`,
        attr: { type: "button" },
      });
      btn.style.setProperty("--node-color", node.color);
      btn.style.setProperty(
        "--node-size",
        `${clamp(node.radius * 4.1, 44, 130)}px`,
      );
      btn.style.setProperty("--node-x", `${node.x}px`);
      btn.style.setProperty("--node-y", `${node.y}px`);
      btn.style.setProperty("--node-z", `${Math.round(node.layer * 12)}px`);
      btn.style.left = `${node.x}px`;
      btn.style.top = `${node.y}px`;
      btn.style.width = `${clamp(node.radius * 4.1, 44, 130)}px`;
      btn.style.height = `${clamp(node.radius * 4.1, 44, 130)}px`;
      btn.style.transform = `translate3d(-50%, -50%, ${Math.round(node.layer * 12)}px) scale(${focusNeighbors && !focusNeighbors.has(node.id) ? 0.92 : 1})`;
      btn.style.opacity =
        focusNeighbors && !focusNeighbors.has(node.id) ? "0.45" : "1";
      btn.title = `${node.label} · ${node.kind} · degree ${node.degree} · score ${node.score.toFixed(1)}`;
      if (focusNeighbors && focusNeighbors.has(node.id))
        btn.dataset.focus = "true";
      const icon = btn.createSpan({ cls: "sauce-graph-node-icon" });
      setIcon(icon, node.icon);
      const text = btn.createDiv({ cls: "sauce-graph-node-text" });
      text.createDiv({ cls: "sauce-graph-node-label", text: node.label });
      text.createDiv({
        cls: "sauce-graph-node-meta",
        text: `${node.kind} · ${node.degree} links · ${node.score.toFixed(1)}`,
      });
      btn.onmouseenter = () => {
        this.highlightId = node.id;
        this.scheduleRender();
      };
      btn.onmouseleave = () => {
        this.highlightId = null;
        this.scheduleRender();
      };
      btn.onclick = () => this.openNode(node);
    }
  }

  private openNode(node: GraphNode): void {
    this.openModalFor(node.file);
  }
}

export class CompatibilityMatrixView extends BaseView {
  getViewType(): string {
    return VIEW_COMPAT;
  }
  getDisplayText(): string {
    return "Sauce: Compatibility Matrix";
  }
  override async onOpen(): Promise<void> {
    const root = this.contentEl;
    root.empty();
    root.addClass("sauce-view");
    root.createEl("h2", { text: "Compatibility Matrix (top 20)" });
    const people = this.plugin.entityService.allPeople().slice(0, 20);
    const cfg = this.plugin.settings.compat_config;
    const grid = root.createDiv({ cls: "sauce-matrix" });
    grid.style.gridTemplateColumns = `repeat(${people.length + 1}, 24px)`;
    grid.createDiv({ cls: "sauce-matrix-cell" });
    for (const p of people)
      grid.createDiv({
        cls: "sauce-matrix-cell",
        text: p.file.basename.slice(0, 2),
      });
    for (const a of people) {
      grid.createDiv({
        cls: "sauce-matrix-cell",
        text: a.file.basename.slice(0, 2),
      });
      for (const b of people) {
        const cms = computeCompatibleSet(
          a.frontmatter,
          b.frontmatter,
          cfg.fields,
        );
        const v = Math.round(cms.density * 100);
        const cell = grid.createDiv({
          cls: "sauce-matrix-cell",
          text: String(v),
        });
        const op = Math.min(1, cms.density * 1.5).toFixed(2);
        cell.style.background = `rgba(80,160,220,${op})`;
      }
    }
  }
  override async onClose(): Promise<void> {}
}

export class TouchHeatmapView extends BaseView {
  getViewType(): string {
    return VIEW_HEATMAP;
  }
  getDisplayText(): string {
    return "Sauce: Touch Heatmap";
  }
  override async onOpen(): Promise<void> {
    const root = this.contentEl;
    root.empty();
    root.addClass("sauce-view");
    root.createEl("h2", { text: "Touch Heatmap (52 weeks)" });
    const counts = new Map<string, number>();
    for (const t of this.plugin.entityService.allTouches()) {
      const d = t.frontmatter.date;
      if (!d) continue;
      counts.set(d, (counts.get(d) ?? 0) + 1);
    }
    const grid = root.createDiv({ cls: "sauce-heatmap" });
    const today = new Date();
    for (let i = 365; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const iso = d.toISOString().slice(0, 10);
      const n = counts.get(iso) ?? 0;
      const level =
        n === 0 ? "" : n === 1 ? "l1" : n === 2 ? "l2" : n < 5 ? "l3" : "l4";
      const cell = grid.createDiv({ cls: `sauce-heatmap-cell ${level}` });
      cell.setAttribute("title", `${iso}: ${n}`);
    }
  }
  override async onClose(): Promise<void> {}
}

export class HierarchyTreeView extends BaseView {
  getViewType(): string {
    return VIEW_HIERARCHY;
  }
  getDisplayText(): string {
    return "Sauce: Hierarchy";
  }
  override async onOpen(): Promise<void> {
    const root = this.contentEl;
    root.empty();
    root.addClass("sauce-view");
    root.createEl("h2", { text: "Org Hierarchy" });
    const orgs = this.plugin.entityService.allOrgs();
    const byName = new Map(orgs.map((o) => [o.file.basename, o]));
    const children = new Map<string, string[]>();
    const tops: string[] = [];
    for (const o of orgs) {
      const p = String(o.frontmatter.parent ?? "")
        .replace(/\[\[|\]\]/g, "")
        .split("|")[0];
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
  override async onClose(): Promise<void> {}
}

export class OverdueQueueView extends BaseView {
  getViewType(): string {
    return VIEW_OVERDUE;
  }
  getDisplayText(): string {
    return "Sauce: Overdue Queue";
  }
  override async onOpen(): Promise<void> {
    const root = this.contentEl;
    root.empty();
    root.addClass("sauce-view");
    root.createEl("h2", { text: "Overdue Queue" });
    const today = new Date();
    const people = this.plugin.entityService
      .allPeople()
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
      r.createDiv({
        cls: "priority",
        text: `${row.days}d · ${row.priority.toFixed(1)}`,
      });
      r.onclick = () => this.openModalFor(row.person.file);
    }
  }
  override async onClose(): Promise<void> {}
}

export class ParentDashboardView extends BaseView {
  getViewType(): string {
    return VIEW_PARENT;
  }
  getDisplayText(): string {
    return "Sauce: Parent Vault Dashboard";
  }
  override async onOpen(): Promise<void> {
    const root = this.contentEl;
    root.empty();
    root.addClass("sauce-view");
    root.createEl("h2", { text: "ParentVault Dashboard" });
    const pv = this.plugin.registry.loadParentVault();
    if (!pv) {
      root.createEl("p", {
        text: "No PARENT-VAULT.md found in this vault root.",
      });
      return;
    }
    root.createEl("p", {
      text: `Vault id: ${pv.vault_id} · policy: ${pv.federation_policy.validation_gate}`,
    });
    const subs = this.plugin.registry.listSubVaults();
    root.createEl("h3", { text: `Registered SubVaults (${subs.length})` });
    const ul = root.createEl("ul");
    for (const sv of subs) {
      const li = ul.createEl("li");
      li.createSpan({ text: `${sv.vault_id} → ${sv.path}` });
      li.createSpan({
        cls: "sauce-fed-badge",
        text: sv.enabled ? "enabled" : "disabled",
      });
    }
    root.createEl("p", { text: `Generated ${todayIso()}` });
  }
  override async onClose(): Promise<void> {}
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function withAlpha(color: string, alpha: number): string {
  if (color.startsWith("#") && color.length === 7) {
    const r = Number.parseInt(color.slice(1, 3), 16);
    const g = Number.parseInt(color.slice(3, 5), 16);
    const b = Number.parseInt(color.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }
  return color;
}
