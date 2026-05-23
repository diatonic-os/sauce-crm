// CMP-16 — VaultStatsStrip
// Three clickable pills showing counts of people / orgs / touches.

export interface VaultStatsStripInput {
  counts: { people: number; orgs: number; touches: number };
  onClick: (kind: "people" | "orgs" | "touches") => void;
}

export function renderVaultStatsStrip(
  parent: HTMLElement,
  input: VaultStatsStripInput,
): HTMLDivElement {
  const strip = parent.createDiv({ cls: "sg-stats-strip" });
  strip.setAttribute("role", "group");
  strip.setAttribute("aria-label", "Vault statistics");

  const items: Array<{ key: "people" | "orgs" | "touches"; label: string }> = [
    { key: "people", label: "People" },
    { key: "orgs", label: "Orgs" },
    { key: "touches", label: "Touches" },
  ];

  for (const item of items) {
    const pill = strip.createEl("button", { cls: "sg-stats-pill" });
    pill.setAttribute("data-kind", item.key);
    pill.setAttribute("aria-label", `${item.label}: ${input.counts[item.key]}`);
    pill.createEl("span", {
      cls: "sg-stats-pill-count",
      text: String(input.counts[item.key]),
    });
    pill.createEl("span", { cls: "sg-stats-pill-label", text: item.label });
    pill.onclick = () => input.onClick(item.key);
  }

  return strip;
}
