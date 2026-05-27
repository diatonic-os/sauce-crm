// SPEC §X — Skill run log viewer. In-memory ring buffer; SkillRuntime pushes on every run.
import { ItemView, WorkspaceLeaf, Notice } from "obsidian";
import type SauceGraphPlugin from "../../../main";
import { type ViewTypeId, asViewTypeId } from "@/types/brands";

export const VIEW_SKILL_RUN_LOG: ViewTypeId = asViewTypeId("sauce-skill-run-log");

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
    root.createEl("h2", { text: "Skill Run Log" });

    const toolbar = root.createDiv({ cls: "sauce-skill-run-toolbar" });
    const refreshBtn = toolbar.createEl("button", {
      cls: "sauce-button",
      text: "Refresh",
    });
    refreshBtn.onclick = () => {
      this.render();
    };

    const clearBtn = toolbar.createEl("button", {
      cls: "sauce-button sauce-button-secondary",
      text: "Clear",
    });
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

    const runtime = this.plugin.skills ?? null;
    if (!runtime) {
      root.createEl("p", { text: "Skill runtime not yet initialized." });
    }

    let rows: SkillRunRow[] = [];
    try {
      rows = skillRunRing.all();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      new Notice(`Read failed: ${msg}`);
      root.createDiv({ cls: "sauce-error", text: `Read failed: ${msg}` });
      return;
    }

    root.createEl("h3", { text: `Recent runs (${rows.length})` });
    const tbl = root.createEl("table", { cls: "sauce-skill-run-table" });
    const head = tbl.createEl("thead").createEl("tr");
    for (const h of ["timestamp", "skill", "status", "mutated", "reason"]) {
      head.createEl("th", { text: h });
    }
    const body = tbl.createEl("tbody");
    if (rows.length === 0) {
      const tr = body.createEl("tr");
      tr.createEl("td", { text: "(no skill runs recorded yet)" });
      return;
    }
    for (const r of rows) {
      const tr = body.createEl("tr");
      tr.createEl("td", { text: new Date(r.ts).toLocaleString() });
      tr.createEl("td", { text: r.skillId });
      tr.createEl("td", { text: r.ok ? "ok" : "failed" });
      tr.createEl("td", { text: String(r.mutatedCount) });
      tr.createEl("td", { text: r.reason ?? "" });
    }
  }
}
