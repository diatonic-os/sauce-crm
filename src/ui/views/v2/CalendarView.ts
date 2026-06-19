// CalendarView — Obsidian ItemView that mounts the Svelte Calendar
// component. Pulls events from the vault's touches/tasks/followups
// folders, mapping each frontmatter type to a date dot.

import { ItemView, WorkspaceLeaf, TFile } from "obsidian";
import { mount, unmount } from "svelte";
import Calendar from "../../svelte/Calendar.svelte";
import type { CalendarEvent } from "../../svelte/CalendarTypes";
import type SauceGraphPlugin from "../../../main";
import { type ViewTypeId, asViewTypeId } from "@/types/brands";
import { SauceViewHelp } from "../../components/v2/SauceViewHelp";

export const VIEW_CALENDAR: ViewTypeId = asViewTypeId("sauce-crm-calendar");

export class CalendarView extends ItemView {
  private svelteApp: ReturnType<typeof mount> | undefined;
  private help!: SauceViewHelp;

  constructor(
    leaf: WorkspaceLeaf,
    public plugin: SauceGraphPlugin,
  ) {
    super(leaf);
  }

  getViewType(): string {
    return VIEW_CALENDAR;
  }
  getDisplayText(): string {
    return "Sauce CRM — Calendar";
  }
  override getIcon(): string {
    return "sauce-touch";
  }

  override async onOpen(): Promise<void> {
    this.contentEl.empty();
    this.contentEl.addClass("sauce-view");
    this.help = new SauceViewHelp();
    this.help.mountHeader(this.contentEl, {
      title: "Calendar",
      icon: "sauce-touch",
      subtitle: "Touches, tasks, and followups by date",
    });
    const events = this.collectEvents();
    this.svelteApp = mount(Calendar, {
      target: this.contentEl,
      props: {
        events,
        onOpenPath: (path: string) => this.openPath(path),
      },
    });
  }

  override async onClose(): Promise<void> {
    if (this.svelteApp) {
      unmount(this.svelteApp);
      this.svelteApp = undefined;
    }
  }

  /** Resolve a calendar event's vault `path` and open it. Mirrors the
   *  resolve-and-guard pattern used by the sibling v2 views (SauceBotChatView,
   *  DashboardViews): only a path that resolves to a real `TFile` is opened —
   *  a missing/stale path (e.g. a deleted touch) is silently ignored rather
   *  than routed through `openLinkText`, which would create a phantom tab. */
  openPath(path: string): void {
    const f = this.plugin.app.vault.getAbstractFileByPath(path);
    if (f instanceof TFile) {
      void this.plugin.app.workspace.getLeaf(false).openFile(f);
    }
    // else: path no longer resolves to a file — nothing to open.
  }

  /** Reads vault for touch / task / followup files and maps each into
   *  a CalendarEvent. Falls back to empty array if EntityService can't
   *  enumerate (e.g. very young vault). */
  private collectEvents(): CalendarEvent[] {
    const out: CalendarEvent[] = [];
    const cache = this.plugin.app.metadataCache;
    const files = this.plugin.app.vault.getMarkdownFiles();
    for (const f of files) {
      const fm = cache.getFileCache(f)?.frontmatter as
        | Record<string, unknown>
        | undefined;
      if (!fm) continue;
      const t = fm.type;
      if (t === "touch" && typeof fm.date === "string") {
        out.push({
          date: fm.date.slice(0, 10),
          kind: "touch",
          label: f.basename,
          path: f.path,
        });
      } else if (t === "task" && typeof fm.due === "string") {
        out.push({
          date: fm.due.slice(0, 10),
          kind: "task",
          label: typeof fm.title === "string" ? fm.title : f.basename,
          path: f.path,
        });
      } else if (t === "followup" && typeof fm.due === "string") {
        out.push({
          date: fm.due.slice(0, 10),
          kind: "followup",
          label: f.basename,
          path: f.path,
        });
      } else if (t === "event" && typeof fm.date === "string") {
        out.push({
          date: fm.date.slice(0, 10),
          kind: "event",
          label: typeof fm.title === "string" ? fm.title : f.basename,
          path: f.path,
        });
      }
    }
    return out;
  }
}
