// CMP-14 — StatusRow decorator
// Mutates an existing Obsidian Setting row to add a right-aligned status pill.

import type { Setting } from "obsidian";

export type PillKind =
  | "success"
  | "warning"
  | "error"
  | "info"
  | "neutral"
  | "pro";

export function decorateStatusRow(
  setting: Setting,
  pill: { kind: PillKind; text: string },
): Setting {
  try {
    const anySetting = setting as unknown as {
      settingEl?: HTMLElement;
      controlEl?: HTMLElement;
    };
    const root = anySetting.settingEl;
    if (root) {
      root.classList.add("sg-status-row");
    }
    const host: HTMLElement | undefined = anySetting.controlEl ?? root;
    if (!host) return setting;

    const span = document.createElement("span");
    span.className = `sg-pill sg-pill-${pill.kind}`;
    span.textContent = pill.text;
    span.setAttribute("aria-label", pill.text);
    host.appendChild(span);
  } catch {
    /* defensive */
  }
  return setting;
}
