// CMP-13 — EmptyStateCard
// Renders an empty-state card for COMING_SOON or DEGRADED tab states.
// The IMPLEMENTED state is never rendered here.

export interface EmptyStateInput {
  state: "COMING_SOON" | "DEGRADED" | "IMPLEMENTED";
  title: string;
  body: string;
  actionLabel?: string;
  onAction?: () => void;
  statusPill?: { kind: "info" | "warning" | "neutral" | "error"; text: string };
}

export function renderEmptyStateCard(
  parent: HTMLElement,
  input: EmptyStateInput
): HTMLDivElement {
  const card = parent.createDiv({ cls: `sg-empty-state sg-empty-state-${input.state.toLowerCase()}` });
  card.setAttribute("role", "status");
  card.setAttribute("data-state", input.state);

  const header = card.createDiv({ cls: "sg-empty-state-header" });
  header.createEl("h3", { cls: "sg-empty-state-title", text: input.title });

  if (input.statusPill) {
    const pill = header.createEl("span", {
      cls: `sg-pill sg-pill-${input.statusPill.kind}`,
      text: input.statusPill.text,
    });
    pill.setAttribute("aria-label", input.statusPill.text);
  }

  card.createEl("p", { cls: "sg-empty-state-body", text: input.body });

  if (input.actionLabel && input.onAction) {
    const btn = card.createEl("button", {
      cls: "sg-empty-state-action mod-cta",
      text: input.actionLabel,
    });
    btn.onclick = () => input.onAction?.();
  }

  return card;
}
