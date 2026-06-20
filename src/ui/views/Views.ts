// View type identifiers + base helper. We export all 8 views from this barrel
// to keep main.ts wiring concise.

import { ItemView, WorkspaceLeaf, TFile, Platform } from "obsidian";
import { type ViewTypeId, asViewTypeId } from "@/types/brands";
import type SauceGraphPlugin from "../../main";
import { Entity } from "../../domain/Entity";
import { Person } from "../../domain/Person";
import { Org } from "../../domain/Org";
import { computeCompatibleSet } from "../../compat/CompatibleSet";
import { todayIso, parseIsoSafe, daysBetween } from "../../util/DateUtil";
import { GraphAtlasService } from "../../services/GraphAtlasService";
import { SauceViewHelp } from "../components/v2/SauceViewHelp";
import {
  RelationshipAnalytics,
  type CrossMatrixReport,
} from "../../services/RelationshipAnalytics";

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
      // `file` is already a resolved TFile — open it directly. The old
      // openLinkText(file.path, …) could crash with "e.toLowerCase is not a
      // function" when the workspace fed it a non-string eState.
      void this.app.workspace.getLeaf(false).openFile(file);
    }
  }
}

export class DashboardView extends BaseView {
  private help!: SauceViewHelp;
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
    this.help = new SauceViewHelp();
    this.help.mountHeader(root, {
      title: "Dashboard",
      icon: "network",
      subtitle: "CRM command center overview",
    });
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
      ["Pipeline", deals.length, "gold"],
      ["Prospects", prospects, "purple"],
      ["Overdue", overdue, overdue ? "red" : "green"],
      ["Addenda", addenda.length, "cyan"],
    ] as const) {
      const k = kpis.createDiv({ cls: `sauce-kpi sauce-kpi--${tone}` });
      k.createDiv({ cls: "label", text: String(label) });
      k.createDiv({ cls: "value", text: String(value) });
    }

    // Analytics engine (W5): real, data-driven suggestions + correlation.
    this.renderAttention(root);
    this.renderCrossMatrix(root);

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
      // Normalize Date | string frontmatter to ISO; raw String() of a YAML
      // Date object fails the ISO regex and flattens the chart.
      touches
        .map((t) => coerceIsoDay(t.frontmatter.date))
        .filter((d): d is string => d !== null),
    );

    const recent = root.createDiv({ cls: "sauce-dashboard-columns" });
    this.renderListCard(
      recent,
      "Recent touches",
      touches
        .slice()
        .sort((a, b) =>
          (coerceIsoDay(b.frontmatter.date) ?? "").localeCompare(
            coerceIsoDay(a.frontmatter.date) ?? "",
          ),
        )
        .slice(0, 8)
        .map((t) => ({
          title: displayWikilink(t.frontmatter.contact) || t.file.basename,
          meta: `${coerceIsoDay(t.frontmatter.date) ?? "?"} - ${String(t.frontmatter.channel ?? "?")}`,
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

  /**
   * W5 — surface the analytics engine's top suggestions ("What needs
   * attention") plus the cadence-vs-closeness correlation stat. Additive:
   * reuses sauce-* classes and the openModalFor link pattern.
   */
  private renderAttention(root: HTMLElement): void {
    const analytics = new RelationshipAnalytics(
      this.app,
      this.plugin.entityService,
    );
    const report = analytics.report();

    const section = root.createDiv({
      cls: "sauce-section sauce-attention",
    });
    const head = section.createDiv({ cls: "sauce-attention-head" });
    head.createEl("h3", { text: "What needs attention" });

    // Correlation stat: do you touch your close contacts more?
    const corr = report.cadenceVsCloseness;
    const stat = head.createDiv({ cls: "sauce-attention-stat" });
    const rTxt = corr.r == null ? "n/a" : corr.r.toFixed(2);
    stat.createSpan({
      cls: "sauce-attention-stat-value",
      text: `cadence×closeness r=${rTxt}`,
    });
    stat.createSpan({
      cls: "sauce-attention-stat-note",
      text: corr.interpretation,
    });

    if (report.suggestions.length === 0) {
      section.createEl("p", {
        cls: "sauce-field-help",
        text: "No attention items — relationships and pipeline are on cadence.",
      });
      return;
    }

    const list = section.createDiv({ cls: "sauce-attention-list" });
    for (const s of report.suggestions) {
      const row = list.createDiv({
        cls: `sauce-attention-row sauce-attention-row--${s.severity}`,
      });
      const sev = row.createSpan({
        cls: `sauce-badge sauce-attention-sev sauce-attention-sev--${s.severity}`,
        text: s.severity,
      });
      void sev;
      const body = row.createDiv({ cls: "sauce-attention-body" });
      body.createDiv({ cls: "sauce-attention-title", text: s.title });
      body.createDiv({ cls: "sauce-attention-rationale", text: s.rationale });
      const file = analytics.fileForSuggestion(s);
      if (file) {
        row.addClass("sauce-attention-row--clickable");
        row.onclick = () => this.openModalFor(file);
      }
    }
  }

  /**
   * Task 2.5 — Correlation matrix & outliers section.
   * Collapsible <details> block appended after "What needs attention".
   * Renders:
   *   1. NxN heatmap coloured by |r|  (.sauce-matrix-* classes)
   *   2. Top-3 pair sentences
   *   3. Outlier rows (.sauce-attention-row) wired to openModalFor
   */
  private renderCrossMatrix(root: HTMLElement): void {
    const analytics = new RelationshipAnalytics(
      this.app,
      this.plugin.entityService,
    );
    try {
      analytics.graphAtlas = new GraphAtlasService(
        this.app,
        this.plugin.entityService,
      );
    } catch {
      // Atlas unavailable; degree column will read 0.
    }
    const nowIso = todayIso();
    let report: CrossMatrixReport;
    try {
      report = analytics.crossMatrix(nowIso);
    } catch {
      return; // silently skip if something goes wrong
    }

    const details = root.createEl("details", {
      cls: "sauce-section sauce-cross-matrix",
    });
    const summary = details.createEl("summary");
    summary.createEl("h3", {
      text: "Correlation matrix & outliers",
      cls: "sauce-cross-matrix-title",
    });

    // ── 1. NxN heatmap ────────────────────────────────────────────────────
    const tableWrap = details.createDiv({ cls: "sauce-matrix-wrap" });
    const table = tableWrap.createEl("table", { cls: "sauce-matrix-table" });

    // Header row
    const thead = table.createEl("thead");
    const headerRow = thead.createEl("tr");
    headerRow.createEl("th", { text: "" }); // corner cell
    for (const v of report.variables) {
      headerRow.createEl("th", {
        cls: "sauce-matrix-header",
        text: v,
      });
    }

    // Body rows
    const tbody = table.createEl("tbody");
    for (let i = 0; i < report.variables.length; i++) {
      const tr = tbody.createEl("tr");
      tr.createEl("th", {
        cls: "sauce-matrix-row-header",
        text: report.variables[i] ?? "",
      });
      for (let j = 0; j < report.variables.length; j++) {
        const td = tr.createEl("td", { cls: "sauce-matrix-cell" });
        if (i === j) {
          td.setText("—");
          td.addClass("sauce-matrix-cell--diag");
        } else {
          const r = report.matrix[i]?.[j];
          if (r == null) {
            td.setText("");
          } else {
            const absR = Math.abs(r);
            // Colour bucket: 0–0.3 low, 0.3–0.6 mid, 0.6–1 high
            const bucket = absR < 0.3 ? "low" : absR < 0.6 ? "mid" : "high";
            td.addClass(`sauce-matrix-cell--${bucket}`);
            if (r < 0) td.addClass("sauce-matrix-cell--neg");
            td.setText(r.toFixed(2));
          }
        }
      }
    }

    // ── 2. Top-3 pairs ────────────────────────────────────────────────────
    const top3 = report.topPairs.slice(0, 3);
    if (top3.length > 0) {
      const pairsWrap = details.createDiv({ cls: "sauce-matrix-pairs" });
      pairsWrap.createEl("h4", { text: "Strongest correlations" });
      for (const pair of top3) {
        const dir = pair.r >= 0 ? "positively" : "negatively";
        pairsWrap.createEl("p", {
          cls: "sauce-matrix-pair-sentence",
          text: `${pair.a} and ${pair.b} are ${pair.strength} correlated ${dir} (r=${pair.r.toFixed(2)}, n=${pair.n})`,
        });
      }
    }

    // ── 3. Outliers ───────────────────────────────────────────────────────
    if (report.outliers.length > 0) {
      const outliersWrap = details.createDiv({ cls: "sauce-matrix-outliers" });
      outliersWrap.createEl("h4", { text: "Statistical outliers" });
      const list = outliersWrap.createDiv({ cls: "sauce-attention-list" });
      for (const o of report.outliers) {
        const sev = Math.abs(o.z) >= 3 ? "critical" : "warning";
        const row = list.createDiv({
          cls: `sauce-attention-row sauce-attention-row--${sev}`,
        });
        const badge = row.createSpan({
          cls: `sauce-badge sauce-attention-sev sauce-attention-sev--${sev}`,
          text: sev,
        });
        void badge;
        const body = row.createDiv({ cls: "sauce-attention-body" });
        body.createDiv({
          cls: "sauce-attention-title",
          text: `${o.name} — ${o.metric}`,
        });
        body.createDiv({ cls: "sauce-attention-rationale", text: o.note });
        const file = this.app.vault.getFileByPath
          ? this.app.vault.getFileByPath(o.path)
          : this.app.vault.getAbstractFileByPath(o.path) instanceof TFile
            ? (this.app.vault.getAbstractFileByPath(o.path) as TFile)
            : null;
        if (file instanceof TFile) {
          row.addClass("sauce-attention-row--clickable");
          row.onclick = () => this.openModalFor(file);
        }
      }
    }

    // Empty-state guard
    if (report.outliers.length === 0 && top3.length === 0) {
      details.createEl("p", {
        cls: "sauce-field-help",
        text: "Not enough data for correlation analysis yet.",
      });
    }
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
  private help!: SauceViewHelp;
  getViewType(): string {
    return VIEW_PIPELINE;
  }
  getDisplayText(): string {
    return "Sauce: Pipeline";
  }
  /** Canonical stage order. Deal stages drawn from `stage` (Airtable-mirror
   *  shape) or `status` (vault pipeline-note shape) are slotted into the
   *  closest canonical lane; anything unrecognized falls into "other" so it
   *  is never silently dropped (the prior bug — lanes were hardcoded to
   *  values like "prospect" that no real note used, so every card was
   *  filtered out and the board read 0 rows). */
  private static readonly STAGE_ORDER: ReadonlyArray<{
    id: string;
    label: string;
    match: (s: string) => boolean;
  }> = [
    {
      id: "prospect",
      label: "Prospect",
      match: (s) => /prospect|qualif|lead|new/.test(s),
    },
    {
      id: "first-touch",
      label: "First touch",
      match: (s) => /first|contact|outreach|touch/.test(s),
    },
    {
      id: "discovery",
      label: "Discovery",
      match: (s) => /discov|qualif.*call|demo|meeting/.test(s),
    },
    {
      id: "proposal",
      label: "Proposal",
      match: (s) => /propos|negoti|quote|pending/.test(s),
    },
    {
      id: "closed-won",
      label: "Closed won",
      match: (s) => /won|active.*client|signed/.test(s),
    },
    {
      id: "closed-lost",
      label: "Closed lost",
      match: (s) => /lost|dead|declin/.test(s),
    },
    { id: "other", label: "Other", match: () => true },
  ];

  private filterStage = "all";

  override async onOpen(): Promise<void> {
    const root = this.contentEl;
    root.empty();
    root.addClass("sauce-view");
    this.help = new SauceViewHelp();
    this.help.mountHeader(root, {
      title: "Pipeline",
      icon: "network",
      subtitle: "Deals on a stage-based kanban board",
    });
    this.renderBody(root);
  }

  private renderBody(root: HTMLElement): void {
    root.querySelectorAll(".sauce-pipeline-body").forEach((n) => n.remove());
    const body = root.createDiv({ cls: "sauce-pipeline-body" });

    const deals = this.collectDeals();

    // Toolbar: KPI summary + stage filter.
    const bar = body.createDiv({ cls: "sauce-toolbar" });
    const totalValue = deals.reduce((s, d) => s + d.value, 0);
    const tiles = bar.createDiv({ cls: "sauce-toolbar-metrics" });
    this.metricTile(tiles, "Deals", String(deals.length));
    this.metricTile(
      tiles,
      "Open value",
      totalValue > 0 ? `$${totalValue.toLocaleString()}` : "n/a",
    );
    const won = deals.filter((d) => d.laneId === "closed-won").length;
    this.metricTile(tiles, "Won", String(won));

    const filterWrap = bar.createDiv({ cls: "sauce-toolbar-controls" });
    const label = filterWrap.createEl("label", {
      cls: "sauce-control-label",
      text: "Stage",
    });
    const select = label.createEl("select", { cls: "sauce-select" });
    select.createEl("option", { text: "All stages", value: "all" });
    for (const lane of PipelineKanbanView.STAGE_ORDER)
      select.createEl("option", { text: lane.label, value: lane.id });
    select.value = this.filterStage;
    select.setAttribute("aria-label", "Filter deals by stage");
    select.onchange = () => {
      this.filterStage = select.value;
      this.renderBody(root);
    };

    if (deals.length === 0) {
      this.emptyState(
        body,
        "No deals yet",
        "Pipeline deals are notes with frontmatter `type: pipeline`. Add one (e.g. from the Airtable sync) and it will appear here.",
      );
      return;
    }

    const visible =
      this.filterStage === "all"
        ? PipelineKanbanView.STAGE_ORDER
        : PipelineKanbanView.STAGE_ORDER.filter(
            (l) => l.id === this.filterStage,
          );

    const board = body.createDiv({ cls: "sauce-kanban" });
    for (const lane of visible) {
      const laneDeals = deals.filter((d) => d.laneId === lane.id);
      // Hide empty lanes only when a specific filter isn't pinning them.
      if (laneDeals.length === 0 && this.filterStage === "all") continue;
      const col = board.createDiv({ cls: "sauce-kanban-col" });
      const head = col.createDiv({ cls: "sauce-kanban-col-head" });
      head.createEl("h3", { text: lane.label });
      head.createSpan({
        cls: "sauce-badge sauce-badge--muted",
        text: String(laneDeals.length),
      });
      if (laneDeals.length === 0) {
        col.createDiv({
          cls: "sauce-kanban-empty",
          text: "No deals in this stage",
        });
        continue;
      }
      for (const d of laneDeals) {
        const card = col.createDiv({
          cls: "sauce-kanban-card",
          attr: { tabindex: "0", role: "button" },
        });
        card.createDiv({ cls: "sauce-card-title", text: d.title });
        const meta = card.createDiv({ cls: "sauce-card-meta" });
        if (d.tier)
          meta.createSpan({
            cls: "sauce-badge sauce-badge--ok",
            text: `Tier ${d.tier}`,
          });
        if (d.segment) meta.createSpan({ text: d.segment });
        if (d.value > 0)
          meta.createSpan({ text: `$${d.value.toLocaleString()}` });
        if (d.coverage)
          card.createDiv({
            cls: "sauce-card-sub",
            text: `Coverage ${d.coverage}`,
          });
        card.setAttribute(
          "aria-label",
          `${d.title}, stage ${lane.label}. Open note.`,
        );
        const open = () => this.openModalFor(d.file);
        card.onclick = open;
        card.onkeydown = (ev: KeyboardEvent) => {
          if (ev.key === "Enter" || ev.key === " ") {
            ev.preventDefault();
            open();
          }
        };
      }
    }
  }

  /** Parse a money-ish string ("$500", "$1,200/mo") into a number. */
  private static parseValue(v: unknown): number {
    if (typeof v === "number") return v;
    if (typeof v !== "string") return 0;
    const m = v.replace(/,/g, "").match(/-?\d+(\.\d+)?/);
    return m ? Number(m[0]) : 0;
  }

  /** Read every `type: pipeline` note into a normalized deal row. Reads both
   *  the Airtable-mirror shape (`stage`, `title`, `value`, `org`) and the
   *  vault pipeline-note shape (`status`, `entity`, `tier`, `segment`,
   *  `coverage`). */
  private collectDeals(): Array<{
    file: TFile;
    title: string;
    laneId: string;
    value: number;
    tier: string;
    segment: string;
    coverage: string;
  }> {
    const out: Array<{
      file: TFile;
      title: string;
      laneId: string;
      value: number;
      tier: string;
      segment: string;
      coverage: string;
    }> = [];
    for (const deal of this.plugin.entityService.allPipelineDeals()) {
      const fm = deal.frontmatter;
      const stageRaw = String(fm.stage ?? fm.status ?? "").toLowerCase();
      const lane =
        PipelineKanbanView.STAGE_ORDER.find((l) => l.match(stageRaw)) ??
        PipelineKanbanView.STAGE_ORDER[
          PipelineKanbanView.STAGE_ORDER.length - 1
        ]!;
      const title =
        displayWikilink(fm.entity) ||
        String(fm.title ?? fm.name ?? deal.file.basename);
      out.push({
        file: deal.file,
        title,
        laneId: lane.id,
        value: PipelineKanbanView.parseValue(fm.value),
        tier: String(fm.tier ?? ""),
        segment: String(fm.segment ?? ""),
        coverage: String(fm.coverage ?? ""),
      });
    }
    return out.sort((a, b) => a.title.localeCompare(b.title));
  }

  private metricTile(parent: HTMLElement, label: string, value: string): void {
    const t = parent.createDiv({ cls: "sauce-metric-tile" });
    t.createDiv({ cls: "sauce-metric-value", text: value });
    t.createDiv({ cls: "sauce-metric-label", text: label });
  }

  private emptyState(parent: HTMLElement, title: string, body: string): void {
    const el = parent.createDiv({ cls: "sauce-empty-state" });
    el.createDiv({ cls: "sauce-empty-title", text: title });
    el.createDiv({ cls: "sauce-empty-body", text: body });
  }

  override async onClose(): Promise<void> {}
}

export class CompatibilityMatrixView extends BaseView {
  private help!: SauceViewHelp;
  getViewType(): string {
    return VIEW_COMPAT;
  }
  getDisplayText(): string {
    return "Sauce: Compatibility Matrix";
  }
  private limit = 20;

  override async onOpen(): Promise<void> {
    const root = this.contentEl;
    root.empty();
    root.addClass("sauce-view");
    this.help = new SauceViewHelp();
    this.help.mountHeader(root, {
      title: "Compatibility Matrix",
      icon: "network",
      subtitle: "Pairwise compatibility scores between people",
    });
    if (Platform.isMobile) {
      this.renderPairList(root, this.plugin.entityService.allPeople());
      return;
    }
    this.renderBody(root);
  }

  /** Mobile-only: render top compatible pairs as a ranked list instead of the NxN grid. */
  private renderPairList(root: HTMLElement, allPeople: Entity[]): void {
    const cfg = this.plugin.settings.compat_config;
    const fields = cfg.fields ?? [];

    const list = root.createDiv({ cls: "sauce-compat-pairlist" });

    if (allPeople.length < 2 || fields.length === 0) {
      const empty = list.createDiv({ cls: "sauce-empty-state" });
      empty.createDiv({
        cls: "sauce-empty-state-title",
        text:
          fields.length === 0
            ? "No compatibility fields configured"
            : "Not enough people",
      });
      return;
    }

    // Compute all pairs, sort descending by density, take top 30.
    const pairs: Array<{
      a: Entity;
      b: Entity;
      density: number;
      shared: string[];
    }> = [];
    for (let i = 0; i < allPeople.length; i++) {
      for (let j = i + 1; j < allPeople.length; j++) {
        const a = allPeople[i] ?? null;
        const b = allPeople[j] ?? null;
        if (!a || !b) continue;
        const cms = computeCompatibleSet(a.frontmatter, b.frontmatter, fields);
        pairs.push({ a, b, density: cms.density, shared: cms.shared });
      }
    }
    pairs.sort((x, y) => y.density - x.density);
    const top = pairs.slice(0, 30);

    for (const { a, b, density, shared } of top) {
      const row = list.createDiv({
        cls: "sauce-attention-row sauce-attention-row--clickable",
      });
      const pct = Math.round(density * 100);
      const body = row.createDiv({ cls: "sauce-attention-body" });
      body.createDiv({
        cls: "sauce-attention-title",
        text: `${a.file.basename} ⇄ ${b.file.basename}`,
      });
      const sharedText = shared.length
        ? shared
            .map((s) => s.replace(/^[^:]+:/, ""))
            .slice(0, 6)
            .join(", ")
        : "no shared characteristics";
      body.createDiv({
        cls: "sauce-attention-rationale",
        text: `${pct}% · shared: ${sharedText}`,
      });
      row.onclick = () => this.openModalFor(a.file);
    }
  }

  private renderBody(root: HTMLElement): void {
    root.querySelectorAll(".sauce-compat-body").forEach((n) => n.remove());
    const body = root.createDiv({ cls: "sauce-compat-body" });

    const cfg = this.plugin.settings.compat_config;
    const fields = cfg.fields ?? [];
    const allPeople = this.plugin.entityService.allPeople();

    // Rank people by how compatible they are with the rest of the set, so the
    // most-connected people fill the visible NxN window — a far more useful
    // matrix than the first N by filename. Self-pairs are excluded.
    const totals = new Map<string, number>();
    for (const a of allPeople) {
      let sum = 0;
      for (const b of allPeople) {
        if (a === b) continue;
        sum += computeCompatibleSet(
          a.frontmatter,
          b.frontmatter,
          fields,
        ).density;
      }
      totals.set(a.file.path, sum);
    }
    const people = allPeople
      .slice()
      .sort(
        (a, b) =>
          (totals.get(b.file.path) ?? 0) - (totals.get(a.file.path) ?? 0),
      )
      .slice(0, this.limit);

    // Toolbar.
    const bar = body.createDiv({ cls: "sauce-toolbar" });
    bar.createDiv({
      cls: "sauce-view-desc",
      text: `Pairwise Compatible-Set density over fields: ${
        fields.length ? fields.join(", ") : "(none configured)"
      }. Cell = % of shared characteristics; hover for the overlap.`,
    });
    if (allPeople.length > this.limit) {
      const controls = bar.createDiv({ cls: "sauce-toolbar-controls" });
      const lbl = controls.createEl("label", {
        cls: "sauce-control-label",
        text: "Show",
      });
      const sel = lbl.createEl("select", { cls: "sauce-select" });
      for (const n of [10, 20, 30, 50])
        sel.createEl("option", { text: `Top ${n}`, value: String(n) });
      sel.value = String(this.limit);
      sel.setAttribute("aria-label", "Number of people to display");
      sel.onchange = () => {
        this.limit = Number(sel.value);
        this.renderBody(root);
      };
    }

    if (people.length < 2 || fields.length === 0) {
      this.emptyCompat(body, people.length, fields.length);
      return;
    }

    const detail = body.createDiv({
      cls: "sauce-matrix-detail",
      attr: { "aria-live": "polite" },
    });
    detail.setText("Hover a cell to inspect the shared characteristics.");

    const wrap = body.createDiv({ cls: "sauce-matrix-wrap" });
    const grid = wrap.createDiv({ cls: "sauce-matrix" });
    grid.style.gridTemplateColumns = `var(--sg-w-144) repeat(${people.length}, minmax(28px, 1fr))`;
    grid.setAttribute("role", "grid");

    // Header row: blank corner + column initials.
    grid.createDiv({ cls: "sauce-matrix-cell sauce-matrix-corner" });
    for (const p of people) {
      const c = grid.createDiv({
        cls: "sauce-matrix-cell sauce-matrix-colhead",
        text: p.file.basename.slice(0, 2),
      });
      c.setAttribute("title", p.file.basename);
    }

    for (const a of people) {
      const rh = grid.createDiv({
        cls: "sauce-matrix-cell sauce-matrix-rowhead",
        text: a.file.basename,
      });
      rh.onclick = () => this.openModalFor(a.file);
      for (const b of people) {
        if (a === b) {
          grid.createDiv({
            cls: "sauce-matrix-cell sauce-matrix-self",
            text: "—",
          });
          continue;
        }
        const cms = computeCompatibleSet(a.frontmatter, b.frontmatter, fields);
        const v = Math.round(cms.density * 100);
        const cell = grid.createDiv({
          cls: "sauce-matrix-cell sauce-matrix-data",
          text: String(v),
          attr: { tabindex: "0", role: "gridcell" },
        });
        // Opaque accent fill scaled by density — readable even at low values.
        cell.style.setProperty(
          "--cell-fill",
          `color-mix(in srgb, var(--interactive-accent) ${clamp(
            v,
            0,
            100,
          )}%, transparent)`,
        );
        if (v >= 55) cell.addClass("sauce-matrix-strong");
        const shared = cms.shared
          .map((s) => s.replace(/^[^:]+:/, ""))
          .slice(0, 12)
          .join(", ");
        const label = `${a.file.basename} ↔ ${b.file.basename}: ${v}% (${cms.shared.length} shared)`;
        cell.setAttribute("title", label);
        cell.setAttribute("aria-label", label);
        const show = () => {
          detail.empty();
          detail.createSpan({
            cls: "sauce-matrix-detail-head",
            text: `${a.file.basename} ↔ ${b.file.basename} · ${v}%`,
          });
          detail.createSpan({
            text: shared ? ` shared: ${shared}` : " no shared characteristics",
          });
        };
        cell.onmouseenter = show;
        cell.onfocus = show;
        cell.onclick = () => this.openModalFor(a.file);
      }
    }
  }

  private emptyCompat(
    parent: HTMLElement,
    peopleCount: number,
    fieldCount: number,
  ): void {
    const el = parent.createDiv({ cls: "sauce-empty-state" });
    if (fieldCount === 0) {
      el.createDiv({
        cls: "sauce-empty-title",
        text: "No compatibility fields configured",
      });
      el.createDiv({
        cls: "sauce-empty-body",
        text: "Set compat_config.fields (e.g. roles, tags, industry, location) in plugin settings to compute pairwise compatibility.",
      });
      return;
    }
    el.createDiv({ cls: "sauce-empty-title", text: "Not enough people" });
    el.createDiv({
      cls: "sauce-empty-body",
      text: `The matrix needs at least 2 people with comparable characteristics (found ${peopleCount}). Add warm-contact notes to populate it.`,
    });
  }

  override async onClose(): Promise<void> {}
}

export class TouchHeatmapView extends BaseView {
  private help!: SauceViewHelp;
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
    this.help = new SauceViewHelp();
    this.help.mountHeader(root, {
      title: "Touch Heatmap",
      icon: "network",
      subtitle: "Daily touch activity over the past year",
    });

    // Aggregate touches by ISO day. ROOT CAUSE of the prior empty heatmap:
    // `fm.date` is a JS Date (unquoted YAML), and was used raw as a Map key,
    // so it never matched the generated ISO strings. coerceIsoDay normalizes
    // Date | string -> "YYYY-MM-DD".
    const counts = new Map<string, number>();
    const byDay = new Map<string, TFile[]>();
    for (const t of this.plugin.entityService.allTouches()) {
      const iso = coerceIsoDay(t.frontmatter.date);
      if (!iso) continue;
      counts.set(iso, (counts.get(iso) ?? 0) + 1);
      if (!byDay.has(iso)) byDay.set(iso, []);
      byDay.get(iso)!.push(t.file);
    }

    const total = [...counts.values()].reduce((s, n) => s + n, 0);
    const activeDays = counts.size;
    const peak = Math.max(0, ...counts.values());

    const tiles = root.createDiv({ cls: "sauce-toolbar-metrics" });
    this.metricTile(tiles, "Touches (365d)", String(total));
    this.metricTile(tiles, "Active days", String(activeDays));
    this.metricTile(tiles, "Busiest day", String(peak));

    if (total === 0) {
      const el = root.createDiv({ cls: "sauce-empty-state" });
      el.createDiv({ cls: "sauce-empty-title", text: "No touches logged" });
      el.createDiv({
        cls: "sauce-empty-body",
        text: "Touch notes (frontmatter `type: touch` with a `date`) will plot here once you log interactions.",
      });
      return;
    }

    const detail = root.createDiv({
      cls: "sauce-matrix-detail",
      attr: { "aria-live": "polite" },
    });
    detail.setText("Hover a day to see its touch count; click to open.");

    // Build a calendar grid: 53 week-columns, 7 day-rows, ending today. Each
    // column is a week; we also emit month labels above the columns.
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    // Align the grid so the rightmost column ends on today; walk back to the
    // start of that week (Sunday).
    const start = new Date(today);
    start.setDate(start.getDate() - 364);
    start.setDate(start.getDate() - start.getDay()); // back to Sunday

    const wrap = root.createDiv({ cls: "sauce-heatmap-wrap" });

    const weeks: Date[][] = [];
    const cursor = new Date(start);
    while (cursor <= today) {
      const week: Date[] = [];
      for (let dow = 0; dow < 7; dow++) {
        week.push(new Date(cursor));
        cursor.setDate(cursor.getDate() + 1);
      }
      weeks.push(week);
    }

    // Month-label row.
    const monthRow = wrap.createDiv({ cls: "sauce-heatmap-months" });
    monthRow.style.gridTemplateColumns = `repeat(${weeks.length}, 1fr)`;
    let lastMonth = -1;
    const MONTHS = [
      "Jan",
      "Feb",
      "Mar",
      "Apr",
      "May",
      "Jun",
      "Jul",
      "Aug",
      "Sep",
      "Oct",
      "Nov",
      "Dec",
    ];
    for (const week of weeks) {
      const first = week[0]!;
      const m = first.getMonth();
      const cell = monthRow.createDiv({ cls: "sauce-heatmap-month" });
      if (m !== lastMonth) {
        cell.setText(MONTHS[m]!);
        lastMonth = m;
      }
    }

    const grid = wrap.createDiv({ cls: "sauce-heatmap" });
    grid.style.gridTemplateColumns = `repeat(${weeks.length}, 1fr)`;
    for (const week of weeks) {
      const colEl = grid.createDiv({ cls: "sauce-heatmap-col" });
      for (const day of week) {
        if (day > today) {
          colEl.createDiv({ cls: "sauce-heatmap-cell is-future" });
          continue;
        }
        const iso = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`;
        const n = counts.get(iso) ?? 0;
        const level =
          n === 0 ? "" : n === 1 ? "l1" : n === 2 ? "l2" : n < 5 ? "l3" : "l4";
        const cell = colEl.createDiv({
          cls: `sauce-heatmap-cell ${level}`.trim(),
          attr: { tabindex: n > 0 ? "0" : "-1" },
        });
        const label = `${iso}: ${n} touch${n === 1 ? "" : "es"}`;
        cell.setAttribute("title", label);
        cell.setAttribute("aria-label", label);
        const show = () => detail.setText(label);
        cell.onmouseenter = show;
        cell.onfocus = show;
        if (n > 0) {
          cell.addClass("is-clickable");
          cell.onclick = () => {
            const files = byDay.get(iso) ?? [];
            if (files[0]) this.openModalFor(files[0]);
          };
        }
      }
    }

    // Legend.
    const legend = root.createDiv({ cls: "sauce-heatmap-legend" });
    legend.createSpan({ text: "Less" });
    for (const lvl of ["", "l1", "l2", "l3", "l4"])
      legend.createDiv({ cls: `sauce-heatmap-cell ${lvl}`.trim() });
    legend.createSpan({ text: "More" });
  }

  private metricTile(parent: HTMLElement, label: string, value: string): void {
    const t = parent.createDiv({ cls: "sauce-metric-tile" });
    t.createDiv({ cls: "sauce-metric-value", text: value });
    t.createDiv({ cls: "sauce-metric-label", text: label });
  }

  override async onClose(): Promise<void> {}
}

export class HierarchyTreeView extends BaseView {
  private help!: SauceViewHelp;
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
    this.help = new SauceViewHelp();
    this.help.mountHeader(root, {
      title: "Hierarchy",
      icon: "network",
      subtitle: "Parent-child tree of your organizations",
    });
    const orgs = this.plugin.entityService
      .allOrgs()
      .filter((e): e is Org => e instanceof Org);
    const { tops, children } = buildOrgHierarchy(orgs);
    const byName = new Map(orgs.map((o) => [o.file.basename, o]));

    const tiles = root.createDiv({ cls: "sauce-toolbar-metrics" });
    const tile = (label: string, value: string) => {
      const t = tiles.createDiv({ cls: "sauce-metric-tile" });
      t.createDiv({ cls: "sauce-metric-value", text: value });
      t.createDiv({ cls: "sauce-metric-label", text: label });
    };
    tile("Orgs", String(orgs.length));
    tile("Roots", String(tops.length));
    tile("Subsidiaries", String(orgs.length - tops.length));

    if (orgs.length === 0) {
      const el = root.createDiv({ cls: "sauce-empty-state" });
      el.createDiv({ cls: "sauce-empty-title", text: "No organizations" });
      el.createDiv({
        cls: "sauce-empty-body",
        text: "Org notes (frontmatter `type: org`) will appear here as a parent-child tree.",
      });
      return;
    }

    const tree = root.createDiv({ cls: "sauce-tree" });
    const render = (name: string, container: HTMLElement) => {
      const kids = children.get(name) ?? [];
      const node = container.createDiv({
        cls: "sauce-tree-node",
        attr: { tabindex: "0", role: "button" },
      });
      node.createSpan({ cls: "sauce-tree-label", text: name });
      if (kids.length > 0)
        node.createSpan({
          cls: "sauce-badge sauce-badge--muted",
          text: String(kids.length),
        });
      const org = byName.get(name);
      if (org) {
        const open = () => this.openModalFor(org.file);
        node.onclick = open;
        node.onkeydown = (ev: KeyboardEvent) => {
          if (ev.key === "Enter" || ev.key === " ") {
            ev.preventDefault();
            open();
          }
        };
      }
      if (kids.length === 0) return;
      const sub = container.createDiv({ cls: "sauce-tree-children" });
      for (const k of kids.slice().sort((a, b) => a.localeCompare(b)))
        render(k, sub);
    };
    for (const t of tops.slice().sort((a, b) => a.localeCompare(b)))
      render(t, tree);
  }
  override async onClose(): Promise<void> {}
}

export class OverdueQueueView extends BaseView {
  private help!: SauceViewHelp;
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
    this.help = new SauceViewHelp();
    this.help.mountHeader(root, {
      title: "Overdue Queue",
      icon: "network",
      subtitle: "People you are overdue to follow up with",
    });
    const today = new Date();
    const rows = this.plugin.entityService
      .allPeople()
      .filter((e) => e instanceof Person && (e as Person).isOverdue(today))
      .map((e) => {
        const p = e as Person;
        const last = parseIsoSafe(p.last_touch);
        const days = last ? daysBetween(last, today) : null;
        // Never-touched people get a large synthetic gap so they sort to the
        // top without a misleading "9999d" label.
        const priority = p.closeness * Math.log(1 + (days ?? 3650));
        return { person: p, days, priority };
      })
      .sort((a, b) => b.priority - a.priority);

    const tiles = root.createDiv({ cls: "sauce-toolbar-metrics" });
    this.metricTile(tiles, "Overdue", String(rows.length));
    const neverTouched = rows.filter((r) => r.days === null).length;
    this.metricTile(tiles, "Never touched", String(neverTouched));

    if (rows.length === 0) {
      const el = root.createDiv({ cls: "sauce-empty-state" });
      el.createDiv({ cls: "sauce-empty-title", text: "All caught up" });
      el.createDiv({
        cls: "sauce-empty-body",
        text: "No contacts are past their follow-up cadence right now.",
      });
      return;
    }

    for (const row of rows) {
      const r = root.createDiv({
        cls: "sauce-overdue-row",
        attr: { tabindex: "0", role: "button" },
      });
      const main = r.createDiv({ cls: "sauce-fed-row-main" });
      main.createDiv({
        cls: "sauce-list-title",
        text: row.person.file.basename,
      });
      main.createDiv({
        cls: "sauce-card-meta",
        text: `closeness ${row.person.closeness} · cadence ${row.person.cadence}`,
      });
      r.createDiv({
        cls: "priority",
        text:
          row.days === null
            ? `never · ${row.priority.toFixed(1)}`
            : `${row.days}d · ${row.priority.toFixed(1)}`,
      });
      const open = () => this.openModalFor(row.person.file);
      r.onclick = open;
      r.onkeydown = (ev: KeyboardEvent) => {
        if (ev.key === "Enter" || ev.key === " ") {
          ev.preventDefault();
          open();
        }
      };
    }
  }

  private metricTile(parent: HTMLElement, label: string, value: string): void {
    const t = parent.createDiv({ cls: "sauce-metric-tile" });
    t.createDiv({ cls: "sauce-metric-value", text: value });
    t.createDiv({ cls: "sauce-metric-label", text: label });
  }

  override async onClose(): Promise<void> {}
}

export class ParentDashboardView extends BaseView {
  private help!: SauceViewHelp;
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
    this.help = new SauceViewHelp();
    this.help.mountHeader(root, {
      title: "Parent Vault Dashboard",
      icon: "network",
      subtitle: "Federated parent and sub-vault overview",
    });
    // --- Local-vault rollup (always rendered; this is the substantive data
    // the prior 138-char stub never surfaced). ---
    const es = this.plugin.entityService;
    const people = es.allPeople();
    const orgs = es.allOrgs();
    const touches = es.allTouches();
    const deals = es.allPipelineDeals();
    const overdue = people.filter(
      (e) => e instanceof Person && (e as Person).isOverdue(),
    ).length;

    const section = root.createDiv({ cls: "sauce-section" });
    section.createEl("h3", { text: "This vault" });
    const tiles = section.createDiv({ cls: "sauce-toolbar-metrics" });
    for (const [label, value] of [
      ["People", people.length],
      ["Orgs", orgs.length],
      ["Touches", touches.length],
      ["Deals", deals.length],
      ["Overdue", overdue],
    ] as const) {
      const t = tiles.createDiv({ cls: "sauce-metric-tile" });
      t.createDiv({ cls: "sauce-metric-value", text: String(value) });
      t.createDiv({ cls: "sauce-metric-label", text: label });
    }

    // --- Federation section. ---
    const fed = root.createDiv({ cls: "sauce-section" });
    fed.createEl("h3", { text: "Federation" });
    const pv = this.plugin.registry.loadParentVault();
    if (!pv) {
      const el = fed.createDiv({ cls: "sauce-empty-state" });
      el.createDiv({
        cls: "sauce-empty-title",
        text: "Standalone vault",
      });
      el.createDiv({
        cls: "sauce-empty-body",
        text: "No PARENT-VAULT.md in this vault root — federation is not configured. The rollup above reflects this vault only.",
      });
      fed.createEl("p", {
        cls: "sauce-field-help",
        text: `Generated ${todayIso()}`,
      });
      return;
    }
    fed.createEl("p", {
      cls: "sauce-view-desc",
      text: `Vault id: ${pv.vault_id} · validation gate: ${pv.federation_policy.validation_gate}`,
    });
    const subs = this.plugin.registry.listSubVaults();
    const enabledCount = subs.filter((s) => s.enabled).length;
    fed.createEl("h4", {
      text: `Registered SubVaults (${enabledCount}/${subs.length} enabled)`,
    });
    if (subs.length === 0) {
      fed.createEl("p", {
        cls: "sauce-field-help",
        text: "No sub-vaults registered yet.",
      });
    }
    for (const sv of subs) {
      const row = fed.createDiv({
        cls: "sauce-overdue-row",
        attr: { tabindex: "0", role: "button" },
      });
      const left = row.createDiv({ cls: "sauce-fed-row-main" });
      left.createDiv({ cls: "sauce-list-title", text: sv.vault_id });
      left.createDiv({ cls: "sauce-card-meta", text: sv.path });
      row.createSpan({
        cls: `sauce-badge ${sv.enabled ? "sauce-badge--ok" : "sauce-badge--muted"}`,
        text: sv.enabled ? "enabled" : "disabled",
      });
      const open = () => this.openModalFor(sv.file);
      row.onclick = open;
      row.onkeydown = (ev: KeyboardEvent) => {
        if (ev.key === "Enter" || ev.key === " ") {
          ev.preventDefault();
          open();
        }
      };
    }
    fed.createEl("p", {
      cls: "sauce-field-help",
      text: `Generated ${todayIso()}`,
    });
  }
  override async onClose(): Promise<void> {}
}

/** Strip an Obsidian wikilink wrapper (`[[Name|Alias]]` → `Name`) from a
 *  typed Org.parent value, returning `null` when there is no parent. */
function orgParentName(org: Org): string | null {
  if (!org.isSubsidiary()) return null;
  const stripped = String(org.parent ?? "").replace(/\[\[|\]\]/g, "");
  return (stripped.split("|")[0] ?? stripped).trim();
}

/** Build the org corporate tree from typed Org instances. An org is a child
 *  when its `.parent` getter resolves to another org present in the set;
 *  everything else (including dangling parents) becomes a top-level root. */
export function buildOrgHierarchy(orgs: Org[]): {
  tops: string[];
  children: Map<string, string[]>;
} {
  const byName = new Map(orgs.map((o) => [o.file.basename, o]));
  const children = new Map<string, string[]>();
  const tops: string[] = [];
  for (const o of orgs) {
    const p = orgParentName(o);
    if (p && byName.has(p)) {
      if (!children.has(p)) children.set(p, []);
      children.get(p)!.push(o.file.basename);
    } else {
      tops.push(o.file.basename);
    }
  }
  return { tops, children };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/** Coerce a frontmatter date value to a `YYYY-MM-DD` string.
 *
 *  Obsidian's YAML parser turns an unquoted `date: 2026-06-01` into a JS
 *  `Date` object, not a string. Code that read `fm.date` as a string (or
 *  used the raw value as a Map key) therefore silently failed to match the
 *  ISO strings generated elsewhere — the documented root cause of the empty
 *  Touch Heatmap and flat Touch Velocity chart. This helper normalizes both
 *  shapes (and ISO-ish strings carrying a time component) to a bare ISO day,
 *  returning `null` when no day can be derived. */
function coerceIsoDay(v: unknown): string | null {
  if (v == null) return null;
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return null;
    // Use UTC so a date-only value (midnight UTC) is not shifted across a
    // day boundary by the local timezone.
    return v.toISOString().slice(0, 10);
  }
  if (typeof v === "string") {
    const m = v.match(/^(\d{4}-\d{2}-\d{2})/);
    return m ? (m[1] ?? null) : null;
  }
  return null;
}

/** Strip an Obsidian wikilink wrapper (`[[Path/Name|Alias]]`) down to a
 *  human-readable display name. Pipeline/touch frontmatter stores linked
 *  entities as wikilinks; this renders them readably. */
function displayWikilink(v: unknown): string {
  if (v == null) return "";
  const raw = String(v)
    .replace(/\[\[|\]\]/g, "")
    .trim();
  if (!raw) return "";
  const afterPipe = raw.includes("|") ? raw.slice(raw.indexOf("|") + 1) : raw;
  const segs = afterPipe.split("/");
  return (segs[segs.length - 1] ?? afterPipe).trim();
}
