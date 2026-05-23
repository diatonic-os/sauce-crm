// CMP-19 — ResetLink
// Appends a small "(reset to recommended)" link to a Setting's description.

import type { Setting } from "obsidian";

export function attachResetLink(
  setting: Setting,
  onReset: () => void,
  label = "reset to recommended",
): Setting {
  try {
    const anySetting = setting as unknown as {
      descEl?: HTMLElement;
      settingEl?: HTMLElement;
    };
    const host: HTMLElement | null | undefined =
      anySetting.descEl ??
      (anySetting.settingEl
        ? (anySetting.settingEl.querySelector(
            ".setting-item-description",
          ) as HTMLElement | null)
        : null);
    if (!host) return setting;

    host.appendChild(document.createTextNode(" "));
    const link = document.createElement("a");
    link.className = "sg-reset-link";
    link.textContent = `(${label})`;
    link.href = "#";
    link.setAttribute("role", "button");
    link.setAttribute("aria-label", label);
    link.onclick = (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      onReset();
    };
    host.appendChild(link);
  } catch {
    /* defensive */
  }
  return setting;
}
