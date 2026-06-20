// CalendarView — Obsidian ItemView that mounts the Svelte Calendar
// component. Pulls events from the vault's touches/tasks/followups
// folders, mapping each frontmatter type to a date dot.

import { ItemView, WorkspaceLeaf, TFile } from "obsidian";
import { openVaultPath } from "../../util/openVaultFile";
import { mount, unmount } from "svelte";
import Calendar from "../../svelte/Calendar.svelte";
import type { CalendarEvent } from "../../svelte/CalendarTypes";
import type SauceGraphPlugin from "../../../main";
import { type ViewTypeId, asViewTypeId } from "@/types/brands";
import { SauceViewHelp } from "../../components/v2/SauceViewHelp";
import {
  quadrantOf,
  urgencyOf,
  importanceOf,
  type TaskInput,
} from "../../../services/tasks/EisenhowerEngine";

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
        onReschedule: (path: string, newDate: string) =>
          this.reschedule(path, newDate),
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
    openVaultPath(this.plugin.app, path);
  }

  /** Reschedule a vault file to a new date by updating its frontmatter.
   *  type=task|followup → writes `due`; type=touch|event → writes `date`. */
  reschedule(path: string, newDate: string): void {
    const f = this.plugin.app.vault.getAbstractFileByPath(path);
    if (!(f instanceof TFile)) return;
    const fm = this.plugin.app.metadataCache.getFileCache(f)
      ?.frontmatter as Record<string, unknown> | undefined;
    if (!fm) return;
    const type = fm["type"];
    const field =
      type === "task" || type === "followup" ? "due" : "date";
    void this.plugin.entityService
      .updateFrontmatter(f, (fm) => {
        fm[field] = newDate;
      })
      .then(() => void this.onOpen());
  }

  /** Reads vault for touch / task / followup files and maps each into
   *  a CalendarEvent. Falls back to empty array if EntityService can't
   *  enumerate (e.g. very young vault). */
  private collectEvents(): CalendarEvent[] {
    const out: CalendarEvent[] = [];
    const cache = this.plugin.app.metadataCache;
    const files = this.plugin.app.vault.getMarkdownFiles();
    const now = new Date();
    for (const f of files) {
      const fm = cache.getFileCache(f)?.frontmatter as
        | Record<string, unknown>
        | undefined;
      if (!fm) continue;
      const t = fm["type"];
      if (t === "touch" && typeof fm["date"] === "string") {
        out.push({
          date: fm["date"].slice(0, 10),
          kind: "touch",
          label: f.basename,
          path: f.path,
        });
      } else if (t === "task" && typeof fm["due"] === "string") {
        const due = fm["due"].slice(0, 10);
        const taskInput: TaskInput = {
          path: f.path,
          title: typeof fm["title"] === "string" ? fm["title"] : f.basename,
          status: typeof fm["status"] === "string" ? fm["status"] : "todo",
          due,
          priority: typeof fm["priority"] === "string" ? fm["priority"] : null,
          contact: typeof fm["contact"] === "string" ? fm["contact"] : null,
          blockedBy: 0,
        };
        const u = urgencyOf(taskInput, now);
        const i = importanceOf(taskInput, 0);
        const quadrant = quadrantOf(u, i);
        out.push({
          date: due,
          kind: "task",
          label:
            typeof fm["title"] === "string" ? fm["title"] : f.basename,
          path: f.path,
          quadrant,
        });
      } else if (t === "followup" && typeof fm["due"] === "string") {
        out.push({
          date: fm["due"].slice(0, 10),
          kind: "followup",
          label: f.basename,
          path: f.path,
        });
      } else if (t === "event" && typeof fm["date"] === "string") {
        out.push({
          date: fm["date"].slice(0, 10),
          kind: "event",
          label: typeof fm["title"] === "string" ? fm["title"] : f.basename,
          path: f.path,
        });
      }
    }
    return out;
  }
}
