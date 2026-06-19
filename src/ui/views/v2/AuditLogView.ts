// SPEC §18.5 — Audit log viewer. Reads from V2Runtime.auditLog (HMAC-chained append-only).
//
// W2 overhaul: live search across all columns, op-type filter, computed summary
// (total entries + distinct ops + latest), op badges, relative timestamps with a
// full-time tooltip, and a genuine empty state. The defensive read-API detection
// (recent/list/all) and chain verification are preserved unchanged.
import { ItemView, WorkspaceLeaf, Notice, setIcon } from "obsidian";
import type SauceGraphPlugin from "../../../main";
import { type ViewTypeId, asViewTypeId } from "@/types/brands";
import { SauceViewHelp } from "../../components/v2/SauceViewHelp";

export const VIEW_AUDIT_LOG: ViewTypeId = asViewTypeId("sauce-audit-log");

const PAGE_SIZE = 50;

interface AuditEntry {
  ts?: number;
  op?: string;
  entityId?: string | null;
  agentId?: string | null;
  integration?: string | null;
  signature?: string;
}

export class AuditLogView extends ItemView {
  private page = 0;
  private help!: SauceViewHelp;
  private query = "";
  private opFilter = "";
  private entries: AuditEntry[] = [];
  private rowsHost: HTMLElement | null = null;

  constructor(
    leaf: WorkspaceLeaf,
    public plugin: SauceGraphPlugin,
  ) {
    super(leaf);
  }
  getViewType(): string {
    return VIEW_AUDIT_LOG;
  }
  getDisplayText(): string {
    return "Sauce: Audit Log";
  }
  override getIcon(): string {
    return "shield";
  }

  override async onOpen(): Promise<void> {
    await this.render();
  }

  override async onClose(): Promise<void> {
    /* no-op */
  }

  private async render(): Promise<void> {
    const root = this.contentEl;
    root.empty();
    root.addClass("sauce-view");
    root.addClass("sauce-audit-log");
    this.help = new SauceViewHelp();
    this.help.mountHeader(root, {
      title: "Audit Log",
      icon: "shield",
      subtitle: "Tamper-evident log of every change",
    });

    const audit = this.plugin.v2?.auditLog ?? null;
    if (!audit) {
      this.renderEmpty(
        root,
        "Audit log not initialized",
        "The audit log requires the LanceDB backend. Once it is available, every change to your vault will be recorded here as a tamper-evident, HMAC-chained entry.",
      );
      return;
    }

    const toolbar = root.createDiv({ cls: "sauce-audit-toolbar" });
    const refreshBtn = toolbar.createEl("button", {
      cls: "sauce-button",
      text: "Refresh",
    });
    refreshBtn.onclick = () => {
      void this.render();
    };
    this.help.register(
      refreshBtn,
      "Refresh",
      "Reload the audit log to show the most recent entries.",
    );

    const verifyBtn = toolbar.createEl("button", {
      cls: "sauce-button sauce-button-secondary",
      text: "Verify Chain",
    });
    this.help.register(
      verifyBtn,
      "Verify Chain",
      "Check that no audit entries have been altered or removed since they were written.",
    );
    verifyBtn.onclick = async () => {
      try {
        const fn = (
          audit as unknown as {
            verifyChain?: () => Promise<{
              ok: boolean;
              brokenAt: number | null;
            }>;
          }
        ).verifyChain;
        if (typeof fn !== "function") {
          new Notice("verify not yet implemented");
          return;
        }
        const result = await fn.call(audit);
        if (result.ok) {
          new Notice("Audit chain verified: OK");
        } else {
          new Notice(`Audit chain BROKEN at ts=${result.brokenAt}`);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        new Notice(`Verify failed: ${msg}`);
        root.createDiv({ cls: "sauce-error", text: `Verify failed: ${msg}` });
      }
    };

    // The AuditLog class currently exposes only append() + verifyChain(); no read API.
    // Check for common read-method names defensively; if none, surface message.
    const candidate = audit as unknown as {
      recent?: (n: number) => Promise<unknown[]>;
      list?: (offset: number, limit: number) => Promise<unknown[]>;
      all?: () => Promise<unknown[]>;
    };
    const readFn = candidate.recent ?? candidate.list ?? candidate.all ?? null;

    if (!readFn) {
      this.renderEmpty(
        root,
        "Read API not available yet",
        "Only append() and verifyChain() are implemented on the AuditLog backend, so entries cannot be listed here yet. Chain verification still works via the toolbar above.",
      );
      return;
    }

    let rows: unknown[] = [];
    try {
      if (candidate.recent) {
        rows = await candidate.recent(PAGE_SIZE * (this.page + 1));
      } else if (candidate.list) {
        rows = await candidate.list(this.page * PAGE_SIZE, PAGE_SIZE);
      } else if (candidate.all) {
        rows = await candidate.all();
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      new Notice(`Audit query failed: ${msg}`);
      root.createDiv({
        cls: "sauce-error",
        text: `Audit query failed: ${msg}`,
      });
      return;
    }

    this.entries = rows as AuditEntry[];

    if (this.entries.length === 0) {
      this.renderEmpty(
        root,
        "No audit entries yet",
        "Changes to your vault — edits, syncs, agent actions — will appear here as signed, chained entries as soon as they happen.",
      );
      return;
    }

    this.renderSummary(root, this.entries);
    this.renderFilters(root, this.entries);

    const wrap = root.createDiv({ cls: "sauce-table-wrap" });
    this.rowsHost = wrap;
    this.buildTable(wrap);
  }

  private renderSummary(root: HTMLElement, entries: AuditEntry[]): void {
    const kpis = root.createDiv({ cls: "sauce-view-kpis sauce-audit-kpis" });

    const total = kpis.createDiv({ cls: "sauce-kpi" });
    total.createDiv({ cls: "sauce-kpi-value", text: String(entries.length) });
    total.createDiv({ cls: "sauce-kpi-label", text: "entries" });

    const ops = new Set(entries.map((e) => e.op ?? "").filter(Boolean));
    const distinct = kpis.createDiv({ cls: "sauce-kpi" });
    distinct.createDiv({ cls: "sauce-kpi-value", text: String(ops.size) });
    distinct.createDiv({ cls: "sauce-kpi-label", text: "operation types" });

    const latest = entries.reduce((m, e) => Math.max(m, e.ts ?? 0), 0);
    if (latest > 0) {
      const recent = kpis.createDiv({ cls: "sauce-kpi" });
      recent.createDiv({
        cls: "sauce-kpi-value sauce-kpi-value--sm",
        text: relativeTime(latest),
      });
      recent.createDiv({ cls: "sauce-kpi-label", text: "latest entry" });
    }
  }

  private renderFilters(root: HTMLElement, entries: AuditEntry[]): void {
    const bar = root.createDiv({ cls: "sauce-fi-toolbar" });

    const searchWrap = bar.createDiv({ cls: "sauce-fi-search" });
    const label = searchWrap.createEl("label", {
      cls: "sauce-fi-search-label",
      text: "Search",
    });
    label.setAttribute("for", "sauce-audit-search");
    const iconEl = searchWrap.createSpan({ cls: "sauce-fi-search-icon" });
    setIcon(iconEl, "search");
    const search = searchWrap.createEl("input", {
      cls: "sauce-input sauce-fi-search-input",
      type: "search",
    }) as HTMLInputElement;
    search.id = "sauce-audit-search";
    search.placeholder = "Filter entries by entity, agent, integration…";
    search.value = this.query;
    search.setAttribute("aria-label", "Filter audit entries");
    this.registerDomEvent(search, "input", () => {
      this.query = search.value.trim().toLowerCase();
      this.rerender();
    });
    this.help.register(
      search,
      "Search",
      "Filters the table live across op, entity, agent, and integration columns.",
    );

    const opWrap = bar.createDiv({ cls: "sauce-fi-field" });
    const opLabel = opWrap.createEl("label", {
      cls: "sauce-fi-search-label",
      text: "Operation",
    });
    opLabel.setAttribute("for", "sauce-audit-op");
    const sel = opWrap.createEl("select", {
      cls: "sauce-input sauce-fi-select",
    }) as HTMLSelectElement;
    sel.id = "sauce-audit-op";
    sel.setAttribute("aria-label", "Filter by operation type");
    sel.createEl("option", { text: "All operations", value: "" });
    const ops = Array.from(
      new Set(entries.map((e) => e.op ?? "").filter(Boolean)),
    ).sort();
    for (const op of ops) sel.createEl("option", { text: op, value: op });
    sel.value = this.opFilter;
    this.registerDomEvent(sel, "change", () => {
      this.opFilter = sel.value;
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
    const filtered = this.entries.filter((r) => {
      if (this.opFilter && (r.op ?? "") !== this.opFilter) return false;
      if (!this.query) return true;
      const hay = [r.op, r.entityId, r.agentId, r.integration]
        .map((x) => (x ?? "").toLowerCase())
        .join(" ");
      return hay.includes(this.query);
    });

    const count = host.createEl("p", {
      cls: "sauce-fi-count",
      text:
        filtered.length === this.entries.length
          ? `Showing all ${this.entries.length} entries`
          : `Showing ${filtered.length} of ${this.entries.length} entries`,
    });
    count.setAttribute("aria-live", "polite");

    if (filtered.length === 0) {
      host.createDiv({
        cls: "sauce-empty sauce-fi-no-match",
        text: "No entries match the current filters.",
      });
      return;
    }

    const tbl = host.createEl("table", { cls: "sauce-index-table" });
    const head = tbl.createEl("thead").createEl("tr");
    for (const h of [
      "When",
      "Operation",
      "Entity",
      "Agent",
      "Integration",
      "Signature",
    ]) {
      head.createEl("th", { text: h });
    }
    const body = tbl.createEl("tbody");
    for (const r of filtered) {
      const tr = body.createEl("tr");
      const when = tr.createEl("td", { cls: "sauce-fi-mtime" });
      if (r.ts) {
        when.setText(relativeTime(r.ts));
        when.title = new Date(r.ts).toLocaleString();
      }
      const opCell = tr.createEl("td");
      if (r.op) {
        const b = opCell.createSpan({
          cls: "sauce-badge sauce-fi-badge",
          text: r.op,
        });
        b.style.setProperty("--sauce-fi-badge-h", String(hashHue(r.op)));
      }
      tr.createEl("td", { text: r.entityId ?? "" });
      tr.createEl("td", { text: r.agentId ?? "" });
      tr.createEl("td", { text: r.integration ?? "" });
      const sig = tr.createEl("td", { cls: "sauce-audit-sig" });
      const sigText = r.signature ?? "";
      sig.setText(sigText ? sigText.slice(0, 16) + "…" : "");
      if (sigText) sig.title = sigText;
    }
  }

  private renderEmpty(root: HTMLElement, title: string, body: string): void {
    const box = root.createDiv({ cls: "sauce-empty-state" });
    const ic = box.createDiv({ cls: "sauce-empty-state-icon" });
    setIcon(ic, "shield");
    box.createEl("h3", { cls: "sauce-empty-state-title", text: title });
    box.createEl("p", { cls: "sauce-empty-state-body", text: body });
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

/** Deterministic hue (0–360) from a label for stable op badge coloring. */
function hashHue(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h % 360;
}
