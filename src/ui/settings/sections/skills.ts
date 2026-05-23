import { Setting } from "obsidian";
import type SauceGraphPlugin from "../../../main";

const LEVELS = ["manual", "suggest", "assist", "auto"] as const;
const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

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
  const s: any = plugin.settings;
  if (!s.skillsAutonomy) s.skillsAutonomy = "manual";
  const save = () => plugin.saveSettings();
  const rerender = () => {
    containerEl.empty();
    renderSkills(containerEl, plugin);
  };
  const setSkill = (id: string, patch: Record<string, unknown>) => {
    try { skillsRt.registry.setSettings(id, patch); } catch { /* noop */ }
  };

  // Master enable — enabling seeds every skill with the global autonomy.
  const masterOn = skills.length > 0 && skills.every((sk) => skillsRt.registry?.getSettings?.(sk.id)?.enabled);
  new Setting(containerEl)
    .setName("Master enable")
    .setDesc("Turn all skills on or off. Enabling sets each skill to the global autonomy below (Manual by default).")
    .addToggle((t) =>
      t.setValue(masterOn).onChange(async (v) => {
        for (const sk of skills) {
          setSkill(sk.id, { enabled: v, ...(v && s.skillsAutonomy !== "custom" ? { autonomy: s.skillsAutonomy } : {}) });
        }
        await save();
        rerender();
      }),
    );

  // Global autonomy — concrete level applies to all; "Custom" → per-skill control.
  new Setting(containerEl)
    .setName("Autonomy (all skills)")
    .setDesc("How much every skill may act without confirmation. Choose Custom to set each skill individually below.")
    .addDropdown((d) => {
      for (const lvl of LEVELS) d.addOption(lvl, cap(lvl));
      d.addOption("custom", "Custom (per skill)");
      d.setValue(s.skillsAutonomy).onChange(async (v) => {
        s.skillsAutonomy = v;
        if (v !== "custom") for (const sk of skills) setSkill(sk.id, { autonomy: v });
        await save();
        rerender();
      });
    });

  if (skills.length === 0) {
    containerEl.createEl("p", { cls: "sauce-field-help", text: "No skills registered." });
    return;
  }

  const custom = s.skillsAutonomy === "custom";
  const tbl = containerEl.createEl("table", { cls: "sauce-settings-table" });
  const head = tbl.createEl("thead").createEl("tr");
  head.createEl("th", { text: "Skill" });
  head.createEl("th", { text: "Enabled", cls: "col-center" });
  head.createEl("th", { text: "Autonomy", cls: "col-center" });
  const tbody = tbl.createEl("tbody");

  for (const sk of skills) {
    const cur = skillsRt.registry?.getSettings?.(sk.id) ?? {};
    const tr = tbody.createEl("tr");

    const nameCell = tr.createEl("td");
    nameCell.createEl("strong", { text: sk.id });
    if (sk.description) nameCell.createEl("div", { cls: "sauce-skill-desc-sm", text: sk.description });

    const enCell = tr.createEl("td", { cls: "col-center" });
    const cb = enCell.createEl("input", { type: "checkbox" }) as HTMLInputElement;
    cb.checked = !!cur.enabled;
    cb.onchange = async () => {
      setSkill(sk.id, { enabled: cb.checked });
      await save();
    };

    const autoCell = tr.createEl("td", { cls: "col-center" });
    const sel = autoCell.createEl("select", { cls: "dropdown sauce-skill-autonomy" }) as HTMLSelectElement;
    for (const lvl of LEVELS) {
      const o = sel.createEl("option", { text: cap(lvl) }) as HTMLOptionElement;
      o.value = lvl;
    }
    // Never blank: fall back to "manual" (|| also catches an empty string).
    sel.value = custom ? cur.autonomy || "manual" : s.skillsAutonomy;
    sel.disabled = !custom; // follows the global setting unless Custom
    sel.title = custom ? "" : "Set Autonomy (all skills) to Custom to edit per-skill.";
    sel.onchange = async () => {
      setSkill(sk.id, { autonomy: sel.value });
      await save();
    };
  }
}
