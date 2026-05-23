// CMP-20 — AdvancedToggle
// Renders a toggle row at the top of a tab body that flips a
// `data-advanced-visible` attribute on the tab parent. CSS uses the
// attribute to hide/show `.sg-advanced` rows in the tab.

export interface AdvancedToggleInput {
  parent: HTMLElement;
  tabId: string;
  initialVisible: boolean;
  onChange: (visible: boolean) => void;
}

export function renderAdvancedToggle(
  input: AdvancedToggleInput,
): HTMLDivElement {
  const { parent, tabId, initialVisible, onChange } = input;

  const row = parent.createDiv({ cls: "sg-advanced-toggle" });
  row.setAttribute("data-tab-id", tabId);

  const label = row.createEl("label", { cls: "sg-advanced-toggle-label" });
  const checkbox = label.createEl("input", { cls: "sg-advanced-toggle-input" });
  checkbox.type = "checkbox";
  checkbox.checked = initialVisible;
  checkbox.setAttribute("aria-label", "Show advanced settings");

  label.createSpan({
    cls: "sg-advanced-toggle-text",
    text: "Show advanced settings",
  });

  const apply = (visible: boolean) => {
    parent.setAttribute("data-advanced-visible", visible ? "true" : "false");
  };
  apply(initialVisible);

  checkbox.addEventListener("change", () => {
    const visible = checkbox.checked;
    apply(visible);
    onChange(visible);
  });

  return row;
}
