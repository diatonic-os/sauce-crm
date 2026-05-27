// Lightweight folder-index views for the content folders a mature vault uses
// (meetings, lanes, weekly). DOM-rendered (no Svelte dep) — each lists the notes
// in its folder with a couple of frontmatter columns, click-to-open.

import { ItemView, WorkspaceLeaf, TFile } from "obsidian";
import type SauceGraphPlugin from "../../../main";
import { type ViewTypeId, asViewTypeId } from "@/types/brands";

export const VIEW_MEETINGS: ViewTypeId = asViewTypeId("sauce-crm-meetings");
export const VIEW_LANES: ViewTypeId = asViewTypeId("sauce-crm-lanes");
export const VIEW_WEEKLY: ViewTypeId = asViewTypeId("sauce-crm-weekly");

interface IndexColumn {
  /** Column header. */
  label: string;
  /** Frontmatter key to read (string-coerced); falls back to "". */
  key: string;
}

/** Shared list-over-a-folder view. Subclasses declare the folder + columns. */
abstract class FolderIndexView extends ItemView {
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
    this.render();
  }

  private render(): void {
    const root = this.contentEl;
    root.empty();
    root.createEl("h3", { text: this.getDisplayText() });

    const rows = this.collectRows();
    if (rows.length === 0) {
      root.createEl("p", {
        text: `No notes in ${this.folder()}/ yet.`,
        cls: "sauce-empty",
      });
      return;
    }

    const cols = this.columns();
    const table = root.createEl("table", { cls: "sauce-index-table" });
    const head = table.createEl("thead").createEl("tr");
    head.createEl("th", { text: "Note" });
    for (const c of cols) head.createEl("th", { text: c.label });

    const tbody = table.createEl("tbody");
    for (const r of rows) {
      const tr = tbody.createEl("tr");
      const link = tr.createEl("td").createEl("a", {
        text: r.title,
        cls: "sauce-link",
      });
      // registerDomEvent ties the listener to view lifecycle (no leak on close).
      this.registerDomEvent(link, "click", (e) => {
        e.preventDefault();
        void this.plugin.app.workspace.openLinkText(r.path, "", false);
      });
      for (const c of cols) tr.createEl("td", { text: r.values[c.key] ?? "" });
    }
  }

  private collectRows(): Array<{
    path: string;
    title: string;
    values: Record<string, string>;
    sort: string;
  }> {
    const prefix = this.folder() + "/";
    const cols = this.columns();
    const sortKey = this.sortKey();
    const cache = this.plugin.app.metadataCache;
    const out: Array<{
      path: string;
      title: string;
      values: Record<string, string>;
      sort: string;
    }> = [];
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
      });
    }
    out.sort((a, b) => b.sort.localeCompare(a.sort));
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
  protected folder(): string {
    return this.plugin.entityService.paths.meetings;
  }
  protected columns(): readonly IndexColumn[] {
    return [
      { label: "Date", key: "date" },
      { label: "Org", key: "org" },
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
  protected folder(): string {
    return this.plugin.entityService.paths.lanes;
  }
  protected override sortKey(): string {
    return "status";
  }
  protected columns(): readonly IndexColumn[] {
    return [
      { label: "Status", key: "status" },
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
  protected folder(): string {
    return this.plugin.entityService.paths.weekly;
  }
  protected columns(): readonly IndexColumn[] {
    return [{ label: "Date", key: "date" }];
  }
}
