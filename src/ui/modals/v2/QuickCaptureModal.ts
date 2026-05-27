// SPEC §32 — Quick Capture. CDEL input → CdelInterpreter → SkillRuntime dispatch.
// Cmd+K friendly. Shows preview of dispatches before commit.

import { App, Modal, Notice } from "obsidian";
import type SauceGraphPlugin from "../../../main";
import { CdelInterpreter, type CdelDispatch } from "../../../language";

export class QuickCaptureModal extends Modal {
  private input!: HTMLTextAreaElement;
  private preview!: HTMLPreElement;
  private interpreter = new CdelInterpreter();

  constructor(
    app: App,
    public plugin: SauceGraphPlugin,
  ) {
    super(app);
  }

  override onOpen(): void {
    const c = this.contentEl;
    c.addClass("sauce-modal");
    c.addClass("sauce-quick-capture");
    c.createEl("h2", { text: "Quick Capture (CDEL)" });
    c.createEl("p", {
      cls: "sauce-quick-hint",
      text: "Type CDEL directives or natural language. Examples: `@person Jane Smith` · `@touch Jane today coffee` · `@org Acme industry:saas`. Cmd+Enter to dispatch.",
    });

    this.input = c.createEl("textarea", { cls: "sauce-quick-input" });
    this.input.rows = 6;
    this.input.placeholder =
      "@person Jane Smith\nemail: jane@example.com\nroles: [advisor]";

    const previewWrap = c.createDiv({ cls: "sauce-quick-preview-wrap" });
    previewWrap.createEl("strong", { text: "Will dispatch:" });
    this.preview = previewWrap.createEl("pre", { cls: "sauce-quick-preview" });

    this.input.addEventListener("input", () => this.refresh());
    this.input.addEventListener("keydown", (ev: KeyboardEvent) => {
      if ((ev.metaKey || ev.ctrlKey) && ev.key === "Enter") {
        ev.preventDefault();
        void this.dispatch();
      }
    });

    const btns = c.createDiv({ cls: "sauce-buttons" });
    btns.createEl("button", {
      text: "Dispatch (Cmd+Enter)",
      cls: "sauce-button",
    }).onclick = () => void this.dispatch();
    btns.createEl("button", {
      text: "Cancel",
      cls: "sauce-button sauce-button-secondary",
    }).onclick = () => this.close();

    setTimeout(() => this.input.focus(), 50);
  }

  private currentDispatches(): {
    dispatches: CdelDispatch[];
    unhandled: string[];
  } {
    const src = this.input.value.trim();
    if (!src) return { dispatches: [], unhandled: [] };
    try {
      return this.interpreter.interpret(src);
    } catch (e: unknown) {
      return { dispatches: [], unhandled: [`parse error: ${e instanceof Error ? e.message : String(e)}`] };
    }
  }

  private refresh(): void {
    const { dispatches, unhandled } = this.currentDispatches();
    const lines: string[] = [];
    for (const d of dispatches)
      lines.push(`→ ${d.skillId}  ${JSON.stringify(d.args).slice(0, 120)}`);
    if (unhandled.length) lines.push("\nUnhandled:");
    for (const u of unhandled) lines.push(`  • ${u}`);
    this.preview.setText(lines.join("\n") || "(empty)");
  }

  private async dispatch(): Promise<void> {
    if (!this.plugin.skills) {
      new Notice("Skills runtime not initialized");
      return;
    }
    const { dispatches, unhandled } = this.currentDispatches();
    if (dispatches.length === 0) {
      new Notice("nothing to dispatch");
      return;
    }
    let ok = 0,
      failed = 0;
    for (const d of dispatches) {
      const skillId = d.skillId.startsWith("cdel.") ? "draft-touch" : d.skillId;
      const r = await this.plugin.skills.run(skillId, d.args);
      if (r.ok) ok++;
      else failed++;
    }
    new Notice(
      `Quick Capture: ${ok} ok, ${failed} failed, ${unhandled.length} unhandled`,
    );
    this.close();
  }

  override onClose(): void {
    this.contentEl.empty();
  }
}
