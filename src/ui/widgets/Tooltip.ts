// Tiny tooltip helper for inline help on settings rows.
// Appends a hover-target `(?)` next to the setting name. Uses the native
// `title` attribute for hover content. If `link` is provided, the marker is
// wrapped in an external-opening anchor.

import type { Setting } from "obsidian";

export function tooltip(setting: Setting, text: string, link?: string): Setting {
  try {
    // Resolve the name element. Obsidian's Setting exposes `nameEl`, but defend
    // against shape changes by falling back to a CSS-selector lookup.
    const anySetting = setting as unknown as { nameEl?: HTMLElement; settingEl?: HTMLElement };
    const host: HTMLElement | null | undefined =
      anySetting.nameEl ??
      (anySetting.settingEl
        ? (anySetting.settingEl.querySelector(".setting-item-name") as HTMLElement | null)
        : null);
    if (!host) return setting;

    const trigger = document.createElement("span");
    trigger.className = "sauce-tooltip-trigger";
    trigger.setAttribute("title", text);
    trigger.setAttribute("aria-label", text);
    trigger.textContent = " (?)";

    if (link) {
      const a = document.createElement("a");
      a.href = link;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.className = "sauce-tooltip-link";
      a.setAttribute("title", text);
      a.setAttribute("aria-label", text);
      a.appendChild(trigger);
      host.appendChild(a);
    } else {
      host.appendChild(trigger);
    }
  } catch {
    /* defensive: Obsidian Setting shape may change — ignore. */
  }
  return setting;
}
