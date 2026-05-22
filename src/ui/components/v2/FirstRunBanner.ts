// CMP-15 — FirstRunBanner
// Welcome banner shown on first install. Dismissible.

export interface FirstRunBannerInput {
  visible: boolean;
  onStart: () => void;
  onDismiss: () => void;
}

export function renderFirstRunBanner(
  parent: HTMLElement,
  input: FirstRunBannerInput
): HTMLDivElement | null {
  if (!input.visible) return null;

  const banner = parent.createDiv({ cls: "sg-first-run-banner" });
  banner.setAttribute("role", "region");
  banner.setAttribute("aria-label", "Welcome to Sauce Graph");

  const content = banner.createDiv({ cls: "sg-first-run-content" });
  content.createEl("h3", {
    cls: "sg-first-run-title",
    text: "Welcome to Sauce Graph",
  });
  content.createEl("p", {
    cls: "sg-first-run-body",
    text: "Build a living map of your people, organizations, and touches. Start by configuring your vault paths and ingestion sources.",
  });

  const actions = content.createDiv({ cls: "sg-first-run-actions" });
  const start = actions.createEl("button", {
    cls: "sg-first-run-start mod-cta",
    text: "Start setup",
  });
  start.onclick = () => input.onStart();

  const dismiss = banner.createEl("button", {
    cls: "sg-first-run-dismiss",
    text: "×",
  });
  dismiss.setAttribute("aria-label", "Dismiss welcome banner");
  dismiss.onclick = () => input.onDismiss();

  return banner;
}
