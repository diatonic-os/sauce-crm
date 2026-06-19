// SauceViewHelp — the shared branding header + toggleable help system every
// Sauce view mounts, so all views are clearly Sauce components and carry the
// same self-serve help affordance.
//
// Usage:
//   const help = new SauceViewHelp();
//   help.mountHeader(root, { title: "SauceBot", icon: "message-circle",
//                            subtitle: "Chat grounded in your relationship graph" });
//   help.register(modelSelectEl, "Model", "Pick which local/cloud model answers…");
//   …
// The help "?" toggle sits top-LEFT of the header. White when off; Sauce purple
// when on. Toggling injects a small helper callout beneath each registered
// field with a tasteful staggered fade+drop-in, and removes them when off.

import { setIcon } from "obsidian";

export interface SauceHelpEntry {
  anchor: HTMLElement;
  title: string;
  body: string;
}

export interface SauceHeaderConfig {
  /** View name shown as the title (the "Sauce" mark is appended automatically). */
  title: string;
  /** Obsidian icon id for the brand glyph (e.g. "message-circle"). */
  icon?: string;
  /** One-line description under the title. */
  subtitle?: string;
}

export class SauceViewHelp {
  private on = false;
  private toggleEl: HTMLButtonElement | null = null;
  private entries: SauceHelpEntry[] = [];
  private rendered: HTMLElement[] = [];

  constructor(private readonly onToggle?: (on: boolean) => void) {}

  /** Build the branded header into `parent`. The help toggle is the first (left-
   *  most) element. Returns the header element for further composition. */
  mountHeader(parent: HTMLElement, cfg: SauceHeaderConfig): HTMLElement {
    const header = parent.createDiv({ cls: "sauce-view-header" });

    const toggle = header.createEl("button", {
      cls: "sauce-help-toggle clickable-icon",
    });
    setIcon(toggle, "help-circle");
    toggle.setAttribute("aria-label", "Toggle help for this view");
    toggle.title = "Toggle help";
    toggle.onclick = () => this.toggle();
    this.toggleEl = toggle;

    const brand = header.createDiv({ cls: "sauce-view-brand" });
    if (cfg.icon) {
      const ic = brand.createSpan({ cls: "sauce-view-brand-icon" });
      setIcon(ic, cfg.icon);
    }
    const titles = brand.createDiv({ cls: "sauce-view-titles" });
    const titleRow = titles.createDiv({ cls: "sauce-view-title-row" });
    titleRow.createSpan({ cls: "sauce-view-title", text: cfg.title });
    titleRow.createSpan({ cls: "sauce-view-mark", text: "Sauce" });
    if (cfg.subtitle)
      titles.createDiv({ cls: "sauce-view-subtitle", text: cfg.subtitle });

    return header;
  }

  /** Register help for a component. Safe to call with a possibly-null anchor. */
  register(anchor: HTMLElement | null | undefined, title: string, body: string): void {
    if (!anchor) return;
    this.entries.push({ anchor, title, body });
    if (this.on) this.renderOne(this.entries.length - 1);
  }

  /** True while help is showing (for callers that want to reflect state). */
  isOn(): boolean {
    return this.on;
  }

  toggle(): void {
    if (this.on) this.hide();
    else this.show();
  }

  private renderOne(i: number): void {
    const e = this.entries[i];
    if (!e) return;
    const callout = createDiv({ cls: "sauce-help-callout" });
    // Staggered entrance so a view's helpers cascade in tastefully.
    callout.style.setProperty("--sauce-help-delay", `${Math.min(i * 45, 270)}ms`);
    callout.createSpan({ cls: "sauce-help-q", text: "?" });
    const txt = callout.createDiv({ cls: "sauce-help-text" });
    txt.createEl("strong", { text: e.title });
    txt.createDiv({ cls: "sauce-help-body", text: e.body });
    e.anchor.insertAdjacentElement("afterend", callout);
    this.rendered.push(callout);
  }

  private show(): void {
    this.on = true;
    this.toggleEl?.addClass("is-on");
    this.entries.forEach((_, i) => this.renderOne(i));
    this.onToggle?.(true);
  }

  private hide(): void {
    this.on = false;
    this.toggleEl?.removeClass("is-on");
    for (const c of this.rendered) c.remove();
    this.rendered = [];
    this.onToggle?.(false);
  }
}
