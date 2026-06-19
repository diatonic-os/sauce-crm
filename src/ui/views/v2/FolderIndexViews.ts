// Lightweight folder-index views for the content folders a mature vault uses
// (meetings, lanes, weekly). DOM-rendered (no Svelte dep) — each lists the notes
// in its folder with a couple of frontmatter columns, click-to-open.
//
// W2 overhaul: rows are now sortable (click a header), live-filterable (search
// box), carry computed summaries (count + recency), and degrade to genuine,
// helpful empty states. WeeklyView additionally surfaces briefing content rather
// than rendering a near-empty one-column list.

import { ItemView, WorkspaceLeaf, TFile, setIcon } from "obsidian";
import type SauceGraphPlugin from "../../../main";
import { type ViewTypeId, asViewTypeId } from "@/types/brands";
import { SauceViewHelp } from "../../components/v2/SauceViewHelp";

export const VIEW_MEETINGS: ViewTypeId = asViewTypeId("sauce-crm-meetings");
export const VIEW_LANES: ViewTypeId = asViewTypeId("sauce-crm-lanes");
export const VIEW_WEEKLY: ViewTypeId = asViewTypeId("sauce-crm-weekly");

interface IndexColumn {
  /** Column header. */
  label: string;
  /** Frontmatter key to read (string-coerced); falls back to "". */
  key: string;
  /** Render this column as a status/category badge rather than plain text. */
  badge?: boolean;
}

interface IndexRow {
  path: string;
  title: string;
  values: Record<string, string>;
  /** Frontmatter mtime-ish sort token (the configured sortKey value). */
  sort: string;
  /** File modified time (ms) for recency summary + the "Modified" pseudo-column. */
  mtime: number;
}

/** Active sort state: column key + direction. Empty key = the title column. */
interface SortState {
  key: string;
  dir: "asc" | "desc";
}

/** Shared list-over-a-folder view. Subclasses declare the folder + columns. */
abstract class FolderIndexView extends ItemView {
  private help!: SauceViewHelp;
  private query = "";
  private sortState: SortState | null = null;

  constructor(
    leaf: WorkspaceLeaf,
    public plugin: SauceGraphPlugin,
  ) {
    super(leaf);
  }

  /** Vault-relative folder this view indexes (e.g. "meetings"). */
  protected abstract folder(): string;
  /** Extra columns beyond the note title. */
  protected abstract columns(): readonly IndexColumn[];
  /** Frontmatter key to sort by, descending. Empty = sort by name. */
  protected sortKey(): string {
    return "date";
  }

  override async onOpen(): Promise<void> {
    this.contentEl.empty();
    this.contentEl.addClass("sauce-view");
    this.contentEl.addClass("sauce-folder-index");
    this.render();
  }

  override async onClose(): Promise<void> {
    /* listeners are registered via registerDomEvent and torn down by the view */
  }

  /** Plain-English description shown under the title in the Sauce header. */
  protected subtitle(): string {
    return "Notes indexed from a vault folder";
  }

  /** Word for a single item, used in summaries/empty states (e.g. "meeting"). */
  protected noun(): string {
    return "note";
  }

  /** Optional richer empty-state guidance for a folder with no notes yet.
   *  Returned as an array of parts; a `{code}` part renders as a styled
   *  inline code span (avoids innerHTML / unsafe markup injection). */
  protected emptyHint(): Array<string | { code: string }> {
    return [
      "Notes saved under ",
      { code: `${this.folder()}/` },
      " will appear here, newest first.",
    ];
  }

  private render(): void {
    const root = this.contentEl;
    root.empty();

    const title = this.getDisplayText()
      .replace(/^Sauce CRM\s*[—-]\s*/, "")
      .replace(/^Sauce:\s*/, "")
      .replace(/^Sauce\s+/, "");
    this.help = new SauceViewHelp();
    this.help.mountHeader(root, {
      title,
      icon: this.getIcon(),
      subtitle: this.subtitle(),
    });

    const rows = this.collectRows();

    if (rows.length === 0) {
      this.renderEmpty(root);
      return;
    }

    this.renderSummary(root, rows);
    const toolbar = this.renderToolbar(root, rows.length);
    const tableHost = root.createDiv({ cls: "sauce-table-wrap" });
    this.renderTable(tableHost, rows);

    // After mount, focus is reachable; help registration ties to the search box.
    this.help.register(
      toolbar.searchEl,
      "Search",
      `Type to filter ${this.noun()}s by title or any visible column. Clears as you delete.`,
    );
  }

  /** Computed summary tiles: total count + most-recent timestamp. */
  private renderSummary(root: HTMLElement, rows: IndexRow[]): void {
    const kpis = root.createDiv({ cls: "sauce-view-kpis sauce-fi-kpis" });

    const total = kpis.createDiv({ cls: "sauce-kpi" });
    total.createDiv({ cls: "sauce-kpi-value", text: String(rows.length) });
    total.createDiv({
      cls: "sauce-kpi-label",
      text: rows.length === 1 ? this.noun() : `${this.noun()}s`,
    });

    const newest = rows.reduce((m, r) => Math.max(m, r.mtime), 0);
    if (newest > 0) {
      const recent = kpis.createDiv({ cls: "sauce-kpi" });
      recent.createDiv({
        cls: "sauce-kpi-value sauce-kpi-value--sm",
        text: relativeTime(newest),
      });
      recent.createDiv({ cls: "sauce-kpi-label", text: "last updated" });
    }
  }

  private renderToolbar(
    root: HTMLElement,
    total: number,
  ): { searchEl: HTMLInputElement } {
    const bar = root.createDiv({ cls: "sauce-fi-toolbar" });

    const searchWrap = bar.createDiv({ cls: "sauce-fi-search" });
    const inputId = `sauce-fi-search-${this.getViewType()}`;
    const label = searchWrap.createEl("label", {
      cls: "sauce-fi-search-label",
      text: "Search",
    });
    label.setAttribute("for", inputId);
    const iconEl = searchWrap.createSpan({ cls: "sauce-fi-search-icon" });
    setIcon(iconEl, "search");
    const search = searchWrap.createEl("input", {
      cls: "sauce-input sauce-fi-search-input",
      type: "search",
    }) as HTMLInputElement;
    search.id = inputId;
    search.placeholder = `Filter ${total} ${this.noun()}${total === 1 ? "" : "s"}…`;
    search.value = this.query;
    search.setAttribute("aria-label", `Filter ${this.noun()}s`);
    this.registerDomEvent(search, "input", () => {
      this.query = search.value.trim().toLowerCase();
      // Re-render only the table region for snappy filtering.
      this.rerenderRows();
    });

    return { searchEl: search };
  }

  /** Cached host so input-driven filtering re-renders only the table body. */
  private rowsHost: HTMLElement | null = null;
  private allRows: IndexRow[] = [];

  private rerenderRows(): void {
    if (!this.rowsHost) return;
    this.rowsHost.empty();
    this.buildTableInto(this.rowsHost, this.allRows);
  }

  private renderTable(host: HTMLElement, rows: IndexRow[]): void {
    this.rowsHost = host;
    this.allRows = rows;
    this.buildTableInto(host, rows);
  }

  private buildTableInto(host: HTMLElement, rows: IndexRow[]): void {
    const cols = this.columns();
    const filtered = this.applyFilter(rows);
    const sorted = this.applySort(filtered);

    if (sorted.length === 0) {
      host.createDiv({
        cls: "sauce-empty sauce-fi-no-match",
        text: `No ${this.noun()}s match “${this.query}”.`,
      });
      return;
    }

    const table = host.createEl("table", { cls: "sauce-index-table" });
    const head = table.createEl("thead").createEl("tr");
    this.headerCell(head, "Note", "", true);
    for (const c of cols) this.headerCell(head, c.label, c.key, false);
    this.headerCell(head, "Modified", "__mtime", false);

    const tbody = table.createEl("tbody");
    for (const r of sorted) {
      const tr = tbody.createEl("tr");
      const link = tr
        .createEl("td", { cls: "sauce-fi-title-cell" })
        .createEl("a", { text: r.title, cls: "sauce-link", href: "#" });
      link.setAttribute("role", "link");
      this.registerDomEvent(link, "click", (e) => {
        e.preventDefault();
        this.openPath(r.path);
      });
      for (const c of cols) {
        const td = tr.createEl("td");
        const val = r.values[c.key] ?? "";
        if (c.badge && val) {
          const b = td.createSpan({
            cls: "sauce-badge sauce-fi-badge",
            text: val,
          });
          b.style.setProperty("--sauce-fi-badge-h", String(hashHue(val)));
        } else {
          td.setText(val);
        }
      }
      tr.createEl("td", {
        cls: "sauce-fi-mtime",
        text: r.mtime ? relativeTime(r.mtime) : "",
      });
    }
  }

  /** A sortable header cell. `isTitle` flags the leading Note column. */
  private headerCell(
    head: HTMLElement,
    label: string,
    key: string,
    isTitle: boolean,
  ): void {
    const th = head.createEl("th", { cls: "sauce-fi-th" });
    const btn = th.createEl("button", {
      cls: "sauce-fi-sort",
      text: label,
    });
    btn.setAttribute("type", "button");
    const sortKey = isTitle ? "" : key;
    const active = this.currentSort().key === sortKey;
    if (active) {
      const arrow = btn.createSpan({ cls: "sauce-fi-sort-arrow" });
      setIcon(
        arrow,
        this.currentSort().dir === "asc" ? "chevron-up" : "chevron-down",
      );
      th.addClass("is-sorted");
    }
    btn.setAttribute(
      "aria-label",
      `Sort by ${label}${active ? ` (${this.currentSort().dir}ending)` : ""}`,
    );
    this.registerDomEvent(btn, "click", () => {
      const cur = this.currentSort();
      if (cur.key === sortKey) {
        this.sortState = {
          key: sortKey,
          dir: cur.dir === "asc" ? "desc" : "asc",
        };
      } else {
        this.sortState = { key: sortKey, dir: sortKey === "" ? "asc" : "desc" };
      }
      this.rerenderRows();
    });
  }

  /** The active sort, defaulting to the configured sortKey descending. */
  private currentSort(): SortState {
    if (this.sortState) return this.sortState;
    return { key: this.sortKey() ? this.sortKey() : "", dir: "desc" };
  }

  private applyFilter(rows: IndexRow[]): IndexRow[] {
    if (!this.query) return rows;
    const cols = this.columns();
    return rows.filter((r) => {
      if (r.title.toLowerCase().includes(this.query)) return true;
      for (const c of cols) {
        if ((r.values[c.key] ?? "").toLowerCase().includes(this.query))
          return true;
      }
      return false;
    });
  }

  private applySort(rows: IndexRow[]): IndexRow[] {
    const { key, dir } = this.currentSort();
    const mul = dir === "asc" ? 1 : -1;
    const get = (r: IndexRow): string | number => {
      if (key === "") return r.title.toLowerCase();
      if (key === "__mtime") return r.mtime;
      if (key === this.sortKey()) return r.sort.toLowerCase();
      return (r.values[key] ?? "").toLowerCase();
    };
    return rows.slice().sort((a, b) => {
      const av = get(a);
      const bv = get(b);
      if (typeof av === "number" && typeof bv === "number")
        return (av - bv) * mul;
      return String(av).localeCompare(String(bv)) * mul;
    });
  }

  private renderEmpty(root: HTMLElement): void {
    const box = root.createDiv({ cls: "sauce-empty-state" });
    const ic = box.createDiv({ cls: "sauce-empty-state-icon" });
    setIcon(ic, this.getIcon());
    box.createEl("h3", {
      cls: "sauce-empty-state-title",
      text: `No ${this.noun()}s yet`,
    });
    const hint = box.createEl("p", { cls: "sauce-empty-state-body" });
    for (const part of this.emptyHint()) {
      if (typeof part === "string") hint.appendText(part);
      else hint.createEl("code", { cls: "sauce-empty-code", text: part.code });
    }
  }

  /** Resolve a vault path and open it in the active leaf (guarded). */
  protected openPath(path: string): void {
    const f = this.plugin.app.vault.getAbstractFileByPath(path);
    if (f instanceof TFile) {
      void this.plugin.app.workspace.getLeaf(false).openFile(f);
    }
  }

  private collectRows(): IndexRow[] {
    const prefix = this.folder() + "/";
    const cols = this.columns();
    const sortKey = this.sortKey();
    const cache = this.plugin.app.metadataCache;
    const out: IndexRow[] = [];
    for (const f of this.plugin.app.vault.getMarkdownFiles()) {
      if (!f.path.startsWith(prefix)) continue;
      const fm = cache.getFileCache(f)?.frontmatter as
        | Record<string, unknown>
        | undefined;
      const values: Record<string, string> = {};
      for (const c of cols) values[c.key] = coerce(fm?.[c.key]);
      out.push({
        path: f.path,
        title: typeof fm?.title === "string" ? fm.title : f.basename,
        values,
        sort: sortKey ? coerce(fm?.[sortKey]) : f.basename,
        mtime: f.stat?.mtime ?? 0,
      });
    }
    return out;
  }

  protected fileCount(): number {
    const prefix = this.folder() + "/";
    return this.plugin.app.vault
      .getMarkdownFiles()
      .filter((f: TFile) => f.path.startsWith(prefix)).length;
  }
}

function coerce(v: unknown): string {
  if (v === undefined || v === null) return "";
  if (Array.isArray(v)) return v.map((x) => String(x)).join(", ");
  return String(v);
}

/** Deterministic hue (0–360) from a label so each status/category badge keeps a
 *  stable, distinct color across renders without a hardcoded palette. */
function hashHue(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h % 360;
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

export class MeetingsView extends FolderIndexView {
  getViewType(): string {
    return VIEW_MEETINGS;
  }
  getDisplayText(): string {
    return "Sauce CRM — Meetings";
  }
  override getIcon(): string {
    return "calendar-clock";
  }
  protected override subtitle(): string {
    return "Your logged meetings, newest first";
  }
  protected override noun(): string {
    return "meeting";
  }
  protected override emptyHint(): Array<string | { code: string }> {
    return [
      "Logged meetings show up here with their date, org, and attendees. Create a meeting note under ",
      { code: `${this.folder()}/` },
      " and it will appear, newest first.",
    ];
  }
  protected folder(): string {
    return this.plugin.entityService.paths.meetings;
  }
  protected columns(): readonly IndexColumn[] {
    return [
      { label: "Date", key: "date" },
      { label: "Org", key: "org", badge: true },
      { label: "Attendees", key: "attendees" },
    ];
  }
}

export class LanesView extends FolderIndexView {
  getViewType(): string {
    return VIEW_LANES;
  }
  getDisplayText(): string {
    return "Sauce CRM — Lanes";
  }
  override getIcon(): string {
    return "rows-3";
  }
  protected override subtitle(): string {
    return "Your work lanes, grouped by status";
  }
  protected override noun(): string {
    return "lane";
  }
  protected override emptyHint(): Array<string | { code: string }> {
    return [
      "Work lanes track parallel streams of work. Add a note under ",
      { code: `${this.folder()}/` },
      " with a status and owner and it will be listed here, sortable by status.",
    ];
  }
  protected folder(): string {
    return this.plugin.entityService.paths.lanes;
  }
  protected override sortKey(): string {
    return "status";
  }
  protected columns(): readonly IndexColumn[] {
    return [
      { label: "Status", key: "status", badge: true },
      { label: "Owner", key: "owner" },
    ];
  }
}

export class WeeklyView extends FolderIndexView {
  getViewType(): string {
    return VIEW_WEEKLY;
  }
  getDisplayText(): string {
    return "Sauce CRM — Weekly Briefings";
  }
  override getIcon(): string {
    return "calendar-range";
  }
  protected override subtitle(): string {
    return "Your weekly briefing notes, newest first";
  }
  protected override noun(): string {
    return "briefing";
  }
  protected override emptyHint(): Array<string | { code: string }> {
    return [
      "Weekly briefings summarize your relationship activity week-by-week. None have been generated yet — once a briefing note lands under ",
      { code: `${this.folder()}/` },
      " (or you run the weekly briefing skill) it will appear here with a preview and its date.",
    ];
  }
  protected folder(): string {
    return this.plugin.entityService.paths.weekly;
  }
  protected columns(): readonly IndexColumn[] {
    return [
      { label: "Date", key: "date" },
      { label: "Summary", key: "summary" },
    ];
  }
}
