// CMP-17 — QuickActionRow
// Horizontal row of icon+label buttons for quick top-level actions.

import { setIcon } from "obsidian";

export interface QuickActionInput {
  actions: Array<{ icon: string; label: string; onClick: () => void }>;
}

export function renderQuickActionRow(
  parent: HTMLElement,
  input: QuickActionInput
): HTMLDivElement {
  const row = parent.createDiv({ cls: "sg-quick-actions" });
  row.setAttribute("role", "group");
  row.setAttribute("aria-label", "Quick actions");

  for (const action of input.actions) {
    const btn = row.createEl("button", { cls: "sg-quick-action" });
    btn.setAttribute("aria-label", action.label);

    const iconEl = btn.createSpan({ cls: "sg-quick-action-icon" });
    try {
      setIcon(iconEl, action.icon);
    } catch {
      /* defensive: bad icon name */
    }

    btn.createSpan({ cls: "sg-quick-action-label", text: action.label });
    btn.onclick = () => action.onClick();
  }

  return row;
}
