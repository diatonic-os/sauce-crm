import { MarkdownPostProcessorContext } from "obsidian";
import type SauceGraphPlugin from "../../main";

export class ActionButton {
  constructor(
    private src: string,
    private el: HTMLElement,
    private ctx: MarkdownPostProcessorContext,
    private plugin: SauceGraphPlugin,
  ) {}

  render(): void {
    let cfg: { command?: string; label?: string } = {};
    try {
      cfg = JSON.parse(this.src.trim() || "{}");
    } catch {
      /* leave empty */
    }
    const btn = this.el.createEl("button", {
      cls: "sauce-action-button",
      text: cfg.label ?? "Run",
    });
    btn.onclick = () => {
      if (cfg.command)
        // app.commands is ambient-typed in src/types/obsidian-augment.ts
        this.plugin.app.commands?.executeCommandById?.(cfg.command);
    };
  }
}
