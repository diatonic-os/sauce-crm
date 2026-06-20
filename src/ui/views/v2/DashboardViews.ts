// Three dashboards in one module — they share the same shape (mount
// Svelte, collect vault rows, unmount on close) so we factor them here
// to keep main.ts's view registrations small.

import { ItemView, WorkspaceLeaf, TFile } from "obsidian";
import { mount, unmount } from "svelte";
import TasksDashboard from "../../svelte/TasksDashboard.svelte";
import InboxDashboard from "../../svelte/InboxDashboard.svelte";
import type { TaskRow, InboxRow } from "../../svelte/DashboardTypes";
import type SauceGraphPlugin from "../../../main";
import { type ViewTypeId, asViewTypeId } from "@/types/brands";
import { SauceViewHelp } from "../../components/v2/SauceViewHelp";

export const VIEW_TASKS: ViewTypeId = asViewTypeId("sauce-crm-tasks-board");
export const VIEW_INBOX: ViewTypeId = asViewTypeId("sauce-crm-inbox");

abstract class SvelteDashboardView extends ItemView {
  protected svelteApp: ReturnType<typeof mount> | undefined;
  constructor(
    leaf: WorkspaceLeaf,
    public plugin: SauceGraphPlugin,
  ) {
    super(leaf);
  }
  override async onClose(): Promise<void> {
    if (this.svelteApp) {
      unmount(this.svelteApp);
      this.svelteApp = undefined;
    }
  }
  /** Resolve a vault `path` to a real `TFile` and open it. Named `openPath`
   *  (NOT `open`) deliberately: `open` is reserved by Obsidian's `View` base
   *  class — defining it here shadows the internal `View.open(eState)` that the
   *  workspace calls during leaf activation, which fed a state object into
   *  `openLinkText` and crashed (`e.toLowerCase is not a function`), leaving the
   *  dashboard blank. Mirrors CalendarView.openPath's resolve-and-guard pattern:
   *  a missing/stale path resolves to nothing rather than a phantom tab. */
  protected openPath(path: string): void {
    const f = this.plugin.app.vault.getAbstractFileByPath(path);
    if (f instanceof TFile) {
      void this.plugin.app.workspace.getLeaf(false).openFile(f);
    }
    // else: path no longer resolves to a file — nothing to open.
  }
}

export class TasksView extends SvelteDashboardView {
  private help!: SauceViewHelp;
  getViewType(): string {
    return VIEW_TASKS;
  }
  getDisplayText(): string {
    return "Sauce CRM — Tasks";
  }
  override getIcon(): string {
    return "sauce-skill";
  }
  override async onOpen(): Promise<void> {
    this.contentEl.empty();
    this.contentEl.addClass("sauce-view");
    this.help = new SauceViewHelp();
    this.help.mountHeader(this.contentEl, {
      title: "Tasks",
      icon: "sauce-skill",
      subtitle: "Track and complete CRM tasks",
    });
    this.svelteApp = mount(TasksDashboard, {
      target: this.contentEl,
      props: {
        rows: this.collectTaskRows(),
        onOpenPath: (p: string) => this.openPath(p),
        onMarkDone: async (p: string) => {
          const f = this.plugin.app.vault.getAbstractFileByPath(p);
          if (f && "extension" in f && f.extension === "md") {
            await this.plugin.entityService.updateFrontmatter(
              f as never,
              (fm) => {
                fm.status = "done";
              },
            );
          }
        },
      },
    });
  }
  private collectTaskRows(): TaskRow[] {
    const out: TaskRow[] = [];
    const cache = this.plugin.app.metadataCache;
    for (const f of this.plugin.app.vault.getMarkdownFiles()) {
      const fm = cache.getFileCache(f)?.frontmatter as
        | Record<string, unknown>
        | undefined;
      if (!fm || fm.type !== "task") continue;
      const _due = typeof fm.due === "string" ? fm.due : undefined;
      const _priority =
        typeof fm.priority === "string" ? fm.priority : undefined;
      const _contact = typeof fm.contact === "string" ? fm.contact : undefined;
      const _tags = Array.isArray(fm.tags)
        ? fm.tags.filter((t): t is string => typeof t === "string")
        : undefined;
      // Normalize status so legacy / loosely-typed values (whitespace,
      // casing, "in-progress" with a hyphen, "in progress" with a space)
      // map onto the canonical enum the dashboard groups by. A missing or
      // unrecognized value falls back to "todo" rather than vanishing.
      out.push({
        path: f.path,
        title: typeof fm.title === "string" ? fm.title : f.basename,
        status:
          typeof fm.status === "string"
            ? fm.status
                .trim()
                .toLowerCase()
                .replace(/[\s-]+/g, "_") || "todo"
            : "todo",
        ...(_due !== undefined ? { due: _due } : {}),
        ...(_priority !== undefined ? { priority: _priority } : {}),
        ...(_contact !== undefined ? { contact: _contact } : {}),
        ...(_tags !== undefined ? { tags: _tags } : {}),
      });
    }
    return out;
  }
}

export class InboxView extends SvelteDashboardView {
  private help!: SauceViewHelp;
  getViewType(): string {
    return VIEW_INBOX;
  }
  getDisplayText(): string {
    return "Sauce CRM — Inbox";
  }
  override getIcon(): string {
    return "sauce-ai-inbox";
  }
  override async onOpen(): Promise<void> {
    this.contentEl.empty();
    this.contentEl.addClass("sauce-view");
    this.help = new SauceViewHelp();
    this.help.mountHeader(this.contentEl, {
      title: "Inbox",
      icon: "sauce-ai-inbox",
      subtitle: "Upcoming touches and follow-ups",
    });
    this.svelteApp = mount(InboxDashboard, {
      target: this.contentEl,
      props: {
        rows: this.collectInboxRows(),
        onOpenPath: (p: string) => this.openPath(p),
      },
    });
  }
  private collectInboxRows(): InboxRow[] {
    const out: InboxRow[] = [];
    const cache = this.plugin.app.metadataCache;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const dayMs = 86_400_000;
    for (const f of this.plugin.app.vault.getMarkdownFiles()) {
      const fm = cache.getFileCache(f)?.frontmatter as
        | Record<string, unknown>
        | undefined;
      if (!fm) continue;
      if (fm.type === "touch" && typeof fm.date === "string") {
        const d = fm.date.slice(0, 10);
        const dt = new Date(d).getTime();
        out.push({
          path: f.path,
          kind: "touch",
          date: d,
          contact: typeof fm.contact === "string" ? fm.contact : "?",
          label: f.basename,
          daysFromToday: Math.round((dt - today.getTime()) / dayMs),
        });
      } else if (
        fm.type === "followup" &&
        typeof fm.due === "string" &&
        (fm.status === "pending" || fm.status === undefined)
      ) {
        const d = fm.due.slice(0, 10);
        const dt = new Date(d).getTime();
        out.push({
          path: f.path,
          kind: "followup",
          date: d,
          contact: typeof fm.contact === "string" ? fm.contact : "?",
          label: f.basename,
          daysFromToday: Math.round((dt - today.getTime()) / dayMs),
        });
      }
    }
    return out;
  }
}

