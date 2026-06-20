// EisenhowerView — a 2×2 Eisenhower Matrix quadrant view for task
// prioritization. Renders Q1 (Do), Q2 (Schedule), Q3 (Delegate),
// Q4 (Eliminate) as clickable task lists.
//
// IMPORTANT: never name a method `open` — it shadows Obsidian's
// View.open(eState) lifecycle hook. Use `openPath` instead.

import { ItemView, WorkspaceLeaf, TFile } from "obsidian";
import type SauceGraphPlugin from "../../../main";
import { type ViewTypeId, asViewTypeId } from "@/types/brands";
import { SauceViewHelp } from "../../components/v2/SauceViewHelp";
import { collectTaskInputs } from "@/services/tasks/collectTasks";
import {
  scoreTasks,
  type Scored,
  type Quadrant,
} from "@/services/tasks/EisenhowerEngine";

export const VIEW_EISENHOWER: ViewTypeId = asViewTypeId("sauce-eisenhower");

const QUADRANT_META: Record<
  Quadrant,
  { label: string; sub: string; cls: string }
> = {
  do: {
    label: "Q1 — Do",
    sub: "Urgent + Important",
    cls: "sauce-eis-q1",
  },
  schedule: {
    label: "Q2 — Schedule",
    sub: "Important, not urgent",
    cls: "sauce-eis-q2",
  },
  delegate: {
    label: "Q3 — Delegate",
    sub: "Urgent, not important",
    cls: "sauce-eis-q3",
  },
  eliminate: {
    label: "Q4 — Eliminate",
    sub: "Neither urgent nor important",
    cls: "sauce-eis-q4",
  },
};

const QUADRANT_ORDER: Quadrant[] = ["do", "schedule", "delegate", "eliminate"];

export class EisenhowerView extends ItemView {
  private help!: SauceViewHelp;

  constructor(
    leaf: WorkspaceLeaf,
    public plugin: SauceGraphPlugin,
  ) {
    super(leaf);
  }

  getViewType(): string {
    return VIEW_EISENHOWER;
  }

  getDisplayText(): string {
    return "Sauce CRM — Eisenhower Matrix";
  }

  override getIcon(): string {
    return "layout-dashboard";
  }

  override async onOpen(): Promise<void> {
    this.contentEl.empty();
    this.contentEl.addClass("sauce-view");

    this.help = new SauceViewHelp();
    this.help.mountHeader(this.contentEl, {
      title: "Eisenhower Matrix",
      icon: "layout-dashboard",
      subtitle: "Prioritize tasks by urgency × importance",
    });

    // Build closeness resolver from vault's warm-contact frontmatter.
    const closenessMap = this.buildClosenessMap();
    const closenessOf = (contact: string | null): number => {
      if (!contact) return 3;
      // contact may be a wikilink [[Name]] or a bare name
      const name = contact.replace(/^\[\[|\]\]$/g, "");
      return closenessMap.get(name) ?? 3;
    };

    const inputs = collectTaskInputs(this.plugin.app);
    const now = new Date();
    const scored = scoreTasks(inputs, closenessOf, now);

    // Group into quadrants
    const byQuadrant = new Map<Quadrant, Scored[]>();
    for (const q of QUADRANT_ORDER) byQuadrant.set(q, []);
    for (const s of scored) {
      const arr = byQuadrant.get(s.quadrant) ?? [];
      arr.push(s);
      byQuadrant.set(s.quadrant, arr);
    }

    // Render 2×2 grid
    const grid = this.contentEl.createDiv({ cls: "sauce-eis-grid" });
    for (const q of QUADRANT_ORDER) {
      const items = byQuadrant.get(q) ?? [];
      const meta = QUADRANT_META[q];
      if (!meta) continue;
      const cell = grid.createDiv({ cls: `sauce-eis-quadrant ${meta.cls}` });
      const hdr = cell.createDiv({ cls: "sauce-eis-quadrant-header" });
      hdr.createEl("h4", { cls: "sauce-eis-quadrant-title", text: meta.label });
      hdr.createEl("p", { cls: "sauce-eis-quadrant-sub", text: meta.sub });
      const badge = hdr.createSpan({ cls: "sauce-badge sauce-eis-count" });
      badge.setText(String(items.length));

      if (items.length === 0) {
        cell.createEl("p", {
          cls: "sauce-eis-empty",
          text: "No tasks in this quadrant",
        });
        continue;
      }

      const list = cell.createEl("ul", { cls: "sauce-eis-task-list" });
      for (const s of items) {
        const li = list.createEl("li", { cls: "sauce-eis-task-row" });
        const btn = li.createEl("button", {
          cls: "sauce-eis-task-title",
          text: s.input.title,
        });
        btn.title = `Open ${s.input.title}`;
        btn.addEventListener("click", () => this.openPath(s.input.path));

        const meta2 = li.createDiv({ cls: "sauce-eis-task-meta" });
        if (s.input.priority) {
          meta2.createSpan({
            cls: `sauce-prio sauce-eis-prio-${s.input.priority}`,
            text: s.input.priority,
          });
        }
        if (s.input.due) {
          meta2.createSpan({
            cls: "sauce-eis-due",
            text: `due ${s.input.due}`,
          });
        }
        if (s.input.contact) {
          meta2.createSpan({
            cls: "sauce-eis-contact",
            text: `@${s.input.contact}`,
          });
        }
      }
    }
  }

  override async onClose(): Promise<void> {
    // nothing to tear down (no Svelte component)
  }

  /** Build a Map<contactName, closeness> from vault warm-contact files. */
  private buildClosenessMap(): Map<string, number> {
    const map = new Map<string, number>();
    const cache = this.plugin.app.metadataCache;
    for (const f of this.plugin.app.vault.getMarkdownFiles()) {
      const fm = cache.getFileCache(f)?.frontmatter as
        | Record<string, unknown>
        | undefined;
      if (!fm || fm["type"] !== "warm-contact") continue;
      const closeness =
        typeof fm["closeness"] === "number"
          ? fm["closeness"]
          : Number(fm["closeness"] ?? 3);
      map.set(f.basename, Number.isFinite(closeness) ? closeness : 3);
    }
    return map;
  }

  /** Resolve a vault path to a TFile and open it.
   *  Named `openPath` (NOT `open`) — `open` is reserved by Obsidian's
   *  View base class. See DashboardViews.reserved-open.test.ts. */
  openPath(path: string): void {
    const f = this.plugin.app.vault.getAbstractFileByPath(path);
    if (f instanceof TFile) {
      void this.plugin.app.workspace.getLeaf(false).openFile(f);
    }
  }
}
