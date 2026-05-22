import { Setting } from "obsidian";
import type SauceGraphPlugin from "../../../main";

export function renderSkills(containerEl: HTMLElement, plugin: SauceGraphPlugin): void {
  plugin.logger?.debug?.("settings.section_render", { section: "skills" });
  const skillsRt: any = (plugin as any).skills;
  if (!skillsRt) {
    const empty = containerEl.createDiv({ cls: "sg-empty-state" });
    empty.createEl("h4", { text: "Skills — coming soon" });
    empty.createEl("p", { text: "Skills runtime not initialized in this build." });
    empty.createEl("span", { cls: "sg-phase-pill", text: "Phase P10" });
    return;
  }

  containerEl.createEl("h3", { text: "Skills" });

  const skills: any[] = skillsRt.list?.() ?? [];

  new Setting(containerEl)
    .setName("Master enable")
    .setDesc("Turn all skills on or off.")
    .addToggle((t) => {
      // Read from first skill's enabled-state as best-available signal
      const anyEnabled = skills.some((s: any) => skillsRt.registry?.getSettings?.(s.id)?.enabled);
      t.setValue(anyEnabled).onChange((v) => {
        for (const s of skills) {
          try { skillsRt.registry.setSettings(s.id, { enabled: v }); } catch { /* noop */ }
        }
        // Re-render
        containerEl.empty();
        renderSkills(containerEl, plugin);
      });
    });

  if (skills.length === 0) {
    containerEl.createEl("p", { text: "No skills registered." });
    return;
  }

  const tbl = containerEl.createEl("table", { cls: "sauce-skills-table sg-skills-table" });
  const head = tbl.createEl("thead").createEl("tr");
  for (const h of ["Skill", "Enabled", "Autonomy"]) head.createEl("th", { text: h });
  const tbody = tbl.createEl("tbody");

  for (const s of skills) {
    const cur = skillsRt.registry?.getSettings?.(s.id) ?? { enabled: false, autonomy: "manual" };
    const tr = tbody.createEl("tr");

    const nameCell = tr.createEl("td");
    nameCell.createEl("strong", { text: s.id });
    if (s.description) nameCell.createEl("div", { cls: "sauce-skill-desc-sm", text: s.description });

    const enCell = tr.createEl("td");
    const cb = enCell.createEl("input", { type: "checkbox" }) as HTMLInputElement;
    cb.checked = !!cur.enabled;
    cb.onchange = () => {
      try { skillsRt.registry.setSettings(s.id, { enabled: cb.checked }); } catch { /* noop */ }
    };

    const autoCell = tr.createEl("td");
    const sel = autoCell.createEl("select") as HTMLSelectElement;
    for (const opt of ["manual", "suggest", "assist", "auto"]) {
      const o = sel.createEl("option", { text: opt }) as HTMLOptionElement;
      o.value = opt;
    }
    sel.value = cur.autonomy ?? "manual";
    sel.onchange = () => {
      try { skillsRt.registry.setSettings(s.id, { autonomy: sel.value }); } catch { /* noop */ }
    };
  }
}
