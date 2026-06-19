// SPEC §X — Skill run log viewer. In-memory ring buffer; SkillRuntime pushes on every run.
//
// W2 overhaul: computed summary (total / succeeded / failed / mutations), live
// search, status filter (all/ok/failed), status badges, relative timestamps with
// a full-time tooltip, and a genuine empty state that explains what populates the
// log. The ring buffer + refresh/clear controls are preserved unchanged.
import { ItemView, WorkspaceLeaf, Notice, setIcon } from "obsidian";
import type SauceGraphPlugin from "../../../main";
import { type ViewTypeId, asViewTypeId } from "@/types/brands";
import { SauceViewHelp } from "../../components/v2/SauceViewHelp";

export const VIEW_SKILL_RUN_LOG: ViewTypeId = asViewTypeId(
  "sauce-skill-run-log",
);

export interface SkillRunRow {
  ts: number;
  skillId: string;
  ok: boolean;
  reason?: string;
  mutatedCount: number;
}

class SkillRunRing {
  static instance = new SkillRunRing();
  private rows: SkillRunRow[] = [];
  max = 200;
  push(r: SkillRunRow) {
    this.rows.push(r);
    if (this.rows.length > this.max) this.rows.shift();
  }
  all(): SkillRunRow[] {
    return this.rows.slice().reverse();
  }
  clear(): void {
    this.rows = [];
  }
}

export const skillRunRing = SkillRunRing.instance;

export class SkillRunLogView extends ItemView {
  private help!: SauceViewHelp;
  private query = "";
  private statusFilter: "" | "ok" | "failed" = "";
  private rows: SkillRunRow[] = [];
  private rowsHost: HTMLElement | null = null;

  constructor(
    leaf: WorkspaceLeaf,
    public plugin: SauceGraphPlugin,
  ) {
    super(leaf);
  }
  getViewType(): string {
    return VIEW_SKILL_RUN_LOG;
  }
  getDisplayText(): string {
    return "Sauce: Skill Run Log";
  }
  override getIcon(): string {
    return "play";
  }

  override async onOpen(): Promise<void> {
    this.render();
  }

  override async onClose(): Promise<void> {
    /* no-op */
  }

  private render(): void {
    const root = this.contentEl;
    root.empty();
    root.addClass("sauce-view");
    root.addClass("sauce-skill-run-log");
    this.help = new SauceViewHelp();
    this.help.mountHeader(root, {
      title: "Skill Run Log",
      icon: "play",
      subtitle: "Recent skill runs and their outcomes",
    });

    const toolbar = root.createDiv({ cls: "sauce-skill-run-toolbar" });
    const refreshBtn = toolbar.createEl("button", {
      cls: "sauce-button",
      text: "Refresh",
    });
    refreshBtn.onclick = () => {
      this.render();
    };
    this.help.register(
      refreshBtn,
      "Refresh",
      "Reload the list to show the latest skill runs.",
    );

    const clearBtn = toolbar.createEl("button", {
      cls: "sauce-button sauce-button-secondary",
      text: "Clear",
    });
    this.help.register(
      clearBtn,
      "Clear",
      "Empty the run log, removing all recorded skill runs.",
    );
    clearBtn.onclick = () => {
      try {
        skillRunRing.clear();
        new Notice("Skill run log cleared");
        this.render();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        new Notice(`Clear failed: ${msg}`);
        root.createDiv({ cls: "sauce-error", text: `Clear failed: ${msg}` });
      }
    };

    let rows: SkillRunRow[] = [];
    try {
      rows = skillRunRing.all();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      new Notice(`Read failed: ${msg}`);
      root.createDiv({ cls: "sauce-error", text: `Read failed: ${msg}` });
      return;
    }
    this.rows = rows;

    const runtime = this.plugin.skills ?? null;

    if (rows.length === 0) {
      const detail = runtime
        ? "No skills have run yet this session. When a skill executes — manually or on a trigger — its outcome (success, mutations made, any failure reason) will appear here, newest first. The log holds the last 200 runs in memory."
        : "The skill runtime is not initialized yet, so no runs can be recorded. Once it starts, every skill execution will be logged here.";
      this.renderEmpty(root, "No skill runs recorded", detail);
      return;
    }

    this.renderSummary(root, rows);
    this.renderFilters(root);

    const wrap = root.createDiv({ cls: "sauce-table-wrap" });
    this.rowsHost = wrap;
    this.buildTable(wrap);
  }

  private renderSummary(root: HTMLElement, rows: SkillRunRow[]): void {
    const okCount = rows.filter((r) => r.ok).length;
    const failCount = rows.length - okCount;
    const mutated = rows.reduce((s, r) => s + (r.mutatedCount || 0), 0);

    const kpis = root.createDiv({ cls: "sauce-view-kpis sauce-skill-kpis" });

    const total = kpis.createDiv({ cls: "sauce-kpi" });
    total.createDiv({ cls: "sauce-kpi-value", text: String(rows.length) });
    total.createDiv({ cls: "sauce-kpi-label", text: "runs" });

    const ok = kpis.createDiv({ cls: "sauce-kpi sauce-kpi--ok" });
    ok.createDiv({ cls: "sauce-kpi-value", text: String(okCount) });
    ok.createDiv({ cls: "sauce-kpi-label", text: "succeeded" });

    const failed = kpis.createDiv({
      cls: failCount > 0 ? "sauce-kpi sauce-kpi--error" : "sauce-kpi",
    });
    failed.createDiv({ cls: "sauce-kpi-value", text: String(failCount) });
    failed.createDiv({ cls: "sauce-kpi-label", text: "failed" });

    const mut = kpis.createDiv({ cls: "sauce-kpi" });
    mut.createDiv({ cls: "sauce-kpi-value", text: String(mutated) });
    mut.createDiv({ cls: "sauce-kpi-label", text: "notes changed" });
  }

  private renderFilters(root: HTMLElement): void {
    const bar = root.createDiv({ cls: "sauce-fi-toolbar" });

    const searchWrap = bar.createDiv({ cls: "sauce-fi-search" });
    const label = searchWrap.createEl("label", {
      cls: "sauce-fi-search-label",
      text: "Search",
    });
    label.setAttribute("for", "sauce-skill-search");
    const iconEl = searchWrap.createSpan({ cls: "sauce-fi-search-icon" });
    setIcon(iconEl, "search");
    const search = searchWrap.createEl("input", {
      cls: "sauce-input sauce-fi-search-input",
      type: "search",
    }) as HTMLInputElement;
    search.id = "sauce-skill-search";
    search.placeholder = "Filter by skill name or failure reason…";
    search.value = this.query;
    search.setAttribute("aria-label", "Filter skill runs");
    this.registerDomEvent(search, "input", () => {
      this.query = search.value.trim().toLowerCase();
      this.rerender();
    });
    this.help.register(
      search,
      "Search",
      "Filters runs live by skill id or the reason text on a failed run.",
    );

    const statusWrap = bar.createDiv({ cls: "sauce-fi-field" });
    const stLabel = statusWrap.createEl("label", {
      cls: "sauce-fi-search-label",
      text: "Status",
    });
    stLabel.setAttribute("for", "sauce-skill-status");
    const sel = statusWrap.createEl("select", {
      cls: "sauce-input sauce-fi-select",
    }) as HTMLSelectElement;
    sel.id = "sauce-skill-status";
    sel.setAttribute("aria-label", "Filter by run status");
    sel.createEl("option", { text: "All runs", value: "" });
    sel.createEl("option", { text: "Succeeded", value: "ok" });
    sel.createEl("option", { text: "Failed", value: "failed" });
    sel.value = this.statusFilter;
    this.registerDomEvent(sel, "change", () => {
      this.statusFilter = sel.value as "" | "ok" | "failed";
      this.rerender();
    });
  }

  private rerender(): void {
    if (this.rowsHost) {
      this.rowsHost.empty();
      this.buildTable(this.rowsHost);
    }
  }

  private buildTable(host: HTMLElement): void {
    const filtered = this.rows.filter((r) => {
      if (this.statusFilter === "ok" && !r.ok) return false;
      if (this.statusFilter === "failed" && r.ok) return false;
      if (!this.query) return true;
      const hay = `${r.skillId} ${r.reason ?? ""}`.toLowerCase();
      return hay.includes(this.query);
    });

    const count = host.createEl("p", {
      cls: "sauce-fi-count",
      text:
        filtered.length === this.rows.length
          ? `Showing all ${this.rows.length} runs`
          : `Showing ${filtered.length} of ${this.rows.length} runs`,
    });
    count.setAttribute("aria-live", "polite");

    if (filtered.length === 0) {
      host.createDiv({
        cls: "sauce-empty sauce-fi-no-match",
        text: "No runs match the current filters.",
      });
      return;
    }

    const tbl = host.createEl("table", { cls: "sauce-index-table" });
    const head = tbl.createEl("thead").createEl("tr");
    for (const h of ["When", "Skill", "Status", "Changed", "Detail"]) {
      head.createEl("th", { text: h });
    }
    const body = tbl.createEl("tbody");
    for (const r of filtered) {
      const tr = body.createEl("tr");
      const when = tr.createEl("td", { cls: "sauce-fi-mtime" });
      when.setText(relativeTime(r.ts));
      when.title = new Date(r.ts).toLocaleString();
      tr.createEl("td", { cls: "sauce-skill-id", text: r.skillId });
      const st = tr.createEl("td");
      st.createSpan({
        cls: r.ok
          ? "sauce-badge sauce-badge--ok"
          : "sauce-badge sauce-badge--error",
        text: r.ok ? "ok" : "failed",
      });
      tr.createEl("td", {
        cls: "sauce-fi-mtime",
        text: r.mutatedCount ? String(r.mutatedCount) : "—",
      });
      tr.createEl("td", { cls: "sauce-skill-reason", text: r.reason ?? "" });
    }
  }

  private renderEmpty(
    root: HTMLElement,
    title: string,
    bodyHtml: string,
  ): void {
    const box = root.createDiv({ cls: "sauce-empty-state" });
    const ic = box.createDiv({ cls: "sauce-empty-state-icon" });
    setIcon(ic, "play");
    box.createEl("h3", { cls: "sauce-empty-state-title", text: title });
    const p = box.createEl("p", { cls: "sauce-empty-state-body" });
    p.setText(bodyHtml);
  }
}

/** Compact relative-time label ("3d ago", "just now") from an epoch-ms time. */
function relativeTime(ms: number): string {
  const diff = Date.now() - ms;
  if (diff < 0) return "just now";
  const min = Math.floor(diff / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d ago`;
  const wk = Math.floor(day / 7);
  if (wk < 5) return `${wk}w ago`;
  const mo = Math.floor(day / 30);
  if (mo < 12) return `${mo}mo ago`;
  return `${Math.floor(day / 365)}y ago`;
}
