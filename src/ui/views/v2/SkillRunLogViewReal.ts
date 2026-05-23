import { ItemView, type Plugin, WorkspaceLeaf } from "obsidian";

export const VIEW_SKILL_RUN_LOG_REAL = "sauce-crm-skill-run-log";

/**
 * Bounded ring buffer for skill-run records — main.ts references this
 * as a singleton appended to when skills execute. Capped to prevent
 * unbounded growth; oldest entries roll off when capacity is reached.
 */
export class SkillRunRing {
  private readonly buf: unknown[] = [];
  constructor(private readonly capacity: number = 200) {}
  push(entry: unknown): void {
    this.buf.push(entry);
    if (this.buf.length > this.capacity) {
      this.buf.splice(0, this.buf.length - this.capacity);
    }
  }
  list(): ReadonlyArray<unknown> { return this.buf; }
  clear(): void { this.buf.length = 0; }
  get length(): number { return this.buf.length; }
}

export const skillRunRing = new SkillRunRing();

export class SkillRunLogViewReal extends ItemView {
  constructor(leaf: WorkspaceLeaf, _plugin: Plugin) {
    super(leaf);
  }
  getViewType(): string { return VIEW_SKILL_RUN_LOG_REAL; }
  getDisplayText(): string { return "Sauce CRM — Skill Run Log"; }
  getIcon(): string { return "skill"; }
  async onOpen(): Promise<void> {
    this.contentEl.empty();
    this.contentEl.createEl("h3", { text: "Sauce CRM Skill Run Log" });
    const list = this.contentEl.createEl("ul");
    for (const entry of skillRunRing.list()) {
      list.createEl("li", { text: typeof entry === "string" ? entry : JSON.stringify(entry) });
    }
    if (skillRunRing.length === 0) {
      this.contentEl.createEl("p", { text: "(no skill runs recorded yet)" });
    }
  }
  async onClose(): Promise<void> { /* nothing to clean up */ }
}
