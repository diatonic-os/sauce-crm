// CMP-18 — HelpPopover
// Attaches a (?) trigger to a Setting's name element; opens a Modal with
// deeper help content and an optional external link.

import { App, Modal } from "obsidian";
import type { Setting } from "obsidian";

export interface HelpPopoverInput {
  title: string;
  body: string;
  link?: { label: string; href: string };
}

class HelpModal extends Modal {
  constructor(
    app: App,
    private input: HelpPopoverInput,
  ) {
    super(app);
  }

  override onOpen(): void {
    const { contentEl, titleEl } = this;
    titleEl.setText(this.input.title);
    contentEl.empty();
    contentEl.addClass("sg-help-popover-modal");

    const bodyEl = contentEl.createEl("p", { cls: "sg-help-popover-body" });
    bodyEl.setText(this.input.body);

    if (this.input.link) {
      const linkRow = contentEl.createDiv({ cls: "sg-help-popover-link-row" });
      const a = linkRow.createEl("a", {
        cls: "sg-help-popover-link",
        text: this.input.link.label,
        href: this.input.link.href,
      });
      a.setAttribute("target", "_blank");
      a.setAttribute("rel", "noopener noreferrer");
    }
  }

  override onClose(): void {
    this.contentEl.empty();
  }
}

export function attachHelpPopover(
  setting: Setting,
  app: App,
  input: HelpPopoverInput,
): Setting {
  try {
    const anySetting = setting as unknown as {
      nameEl?: HTMLElement;
      settingEl?: HTMLElement;
    };
    const host: HTMLElement | null | undefined =
      anySetting.nameEl ??
      (anySetting.settingEl
        ? (anySetting.settingEl.querySelector(
            ".setting-item-name",
          ) as HTMLElement | null)
        : null);
    if (!host) return setting;

    const trigger = document.createElement("button");
    trigger.className = "sg-help-trigger";
    trigger.type = "button";
    trigger.textContent = "(?)";
    trigger.setAttribute("aria-label", `Help: ${input.title}`);
    trigger.onclick = (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      new HelpModal(app, input).open();
    };
    host.appendChild(trigger);
  } catch {
    /* defensive */
  }
  return setting;
}
