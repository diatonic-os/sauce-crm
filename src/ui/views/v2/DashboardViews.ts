// Three dashboards in one module — they share the same shape (mount
// Svelte, collect vault rows, unmount on close) so we factor them here
// to keep main.ts's view registrations small.

import { ItemView, WorkspaceLeaf } from "obsidian";
import { mount, unmount } from "svelte";
import TasksDashboard from "../../svelte/TasksDashboard.svelte";
import InboxDashboard from "../../svelte/InboxDashboard.svelte";
import LedgerDashboard from "../../svelte/LedgerDashboard.svelte";
import type { TaskRow, InboxRow, LedgerRow } from "../../svelte/DashboardTypes";
import type SauceGraphPlugin from "../../../main";
import { type ViewTypeId, asViewTypeId } from "@/types/brands";

export const VIEW_TASKS: ViewTypeId = asViewTypeId("sauce-crm-tasks-board");
export const VIEW_INBOX: ViewTypeId = asViewTypeId("sauce-crm-inbox");
export const VIEW_LEDGER: ViewTypeId = asViewTypeId("sauce-crm-ledger");

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
  protected open(path: string): void {
    this.plugin.app.workspace.openLinkText(path, "", false).catch(() => {
      /* ignore */
    });
  }
}

export class TasksView extends SvelteDashboardView {
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
    this.svelteApp = mount(TasksDashboard, {
      target: this.contentEl,
      props: {
        rows: this.collectTaskRows(),
        onOpenPath: (p: string) => this.open(p),
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
      out.push({
        path: f.path,
        title: typeof fm.title === "string" ? fm.title : f.basename,
        status: typeof fm.status === "string" ? fm.status : "todo",
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
    this.svelteApp = mount(InboxDashboard, {
      target: this.contentEl,
      props: {
        rows: this.collectInboxRows(),
        onOpenPath: (p: string) => this.open(p),
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

export class LedgerView extends SvelteDashboardView {
  getViewType(): string {
    return VIEW_LEDGER;
  }
  getDisplayText(): string {
    return "Sauce CRM — Ledger";
  }
  override getIcon(): string {
    return "sauce-audit";
  }
  override async onOpen(): Promise<void> {
    this.contentEl.empty();
    this.contentEl.addClass("sauce-view");
    this.svelteApp = mount(LedgerDashboard, {
      target: this.contentEl,
      props: {
        rows: this.collectLedgerRows(),
        onOpenPath: (p: string) => this.open(p),
      },
    });
  }
  private collectLedgerRows(): LedgerRow[] {
    const out: LedgerRow[] = [];
    const cache = this.plugin.app.metadataCache;
    for (const f of this.plugin.app.vault.getMarkdownFiles()) {
      const fm = cache.getFileCache(f)?.frontmatter as
        | Record<string, unknown>
        | undefined;
      if (!fm || fm.type !== "ledger-entry") continue;
      const amount =
        typeof fm.amount === "number" ? fm.amount : Number(fm.amount);
      if (!Number.isFinite(amount)) continue;
      const direction = fm.direction === "in" ? "in" : "out";
      const _notes = typeof fm.notes === "string" ? fm.notes : undefined;
      out.push({
        path: f.path,
        date: typeof fm.date === "string" ? fm.date : "",
        contact: typeof fm.contact === "string" ? fm.contact : "?",
        category: typeof fm.category === "string" ? fm.category : "?",
        amount,
        currency: typeof fm.currency === "string" ? fm.currency : "USD",
        direction,
        ...(_notes !== undefined ? { notes: _notes } : {}),
      });
    }
    return out;
  }
}
