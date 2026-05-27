// SPEC §S3/§S5/§F3 — Real Skills settings page: enable/disable + autonomy per
// skill, with persistence via SettingsHost.setConfig("skills.*", ...).
// G-001: tokenized CSS only (sauce-*, --sg-*). No inline spacing styles.

import { SettingsPage, type SettingsHost, el } from "./SettingsPage";
import type { SkillRegistry, SkillSettings } from "../../skills/SkillRegistry";
import type SauceGraphPlugin from "../../main";
import type { SkillRuntime } from "../../skills/SkillRuntime";

const AUTONOMY_LEVELS = [
  "propose",
  "confirm-each",
  "confirm-bulk",
  "autonomous",
] as const;

const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

/** Persistence key prefix for skill settings stored via SettingsHost. */
const SKILL_KEY = (id: string): string => `skills.${id}`;

export class SkillsPage extends SettingsPage {
  readonly id = "skills";
  readonly title = "Skills";
  readonly group = "ai";

  constructor(private readonly host: SettingsHost) {
    super();
  }

  render(containerEl: HTMLElement): void {
    containerEl.empty?.();
    containerEl.appendChild(el("h2", {}, this.title));

    // Resolve the plugin handle (same pattern as LocalLLMPage).
    const plugin = this.host.getConfig<SauceGraphPlugin | null>(
      "plugin.handle",
      null,
    );
    const skillsRt: SkillRuntime | null = plugin?.skills ?? null;
    const registry: SkillRegistry | null = skillsRt?.registry ?? null;

    if (!registry) {
      containerEl.appendChild(
        el(
          "p",
          { class: "sauce-settings-hint" },
          "Skills runtime not yet initialized. Open this page again after the plugin finishes loading.",
        ),
      );
      return;
    }

    containerEl.appendChild(
      el(
        "p",
        { class: "sauce-settings-hint" },
        "Enable or disable each skill and set its autonomy level. Changes are persisted immediately.",
      ),
    );

    const skills = registry.list();
    if (skills.length === 0) {
      containerEl.appendChild(
        el("p", { class: "sauce-settings-hint" }, "No skills registered."),
      );
      return;
    }

    // Load persisted settings into the in-memory registry so the UI reflects
    // what was saved last session.
    for (const sk of skills) {
      const saved = this.host.getConfig<Partial<SkillSettings> | null>(
        SKILL_KEY(sk.id),
        null,
      );
      if (saved) registry.setSettings(sk.id, saved);
    }

    const rerender = (): void => {
      this.render(containerEl);
    };

    // Build the table.
    const tbl = containerEl.appendChild(
      el("table", { class: "sauce-settings-table" }),
    );
    const head = tbl.appendChild(el("thead", {})).appendChild(el("tr", {}));
    head.appendChild(el("th", {}, "Skill"));
    head.appendChild(el("th", { class: "col-center" }, "Enabled"));
    head.appendChild(el("th", { class: "col-center" }, "Autonomy"));
    head.appendChild(el("th", {}, "Description"));

    const tbody = tbl.appendChild(el("tbody", {}));

    for (const sk of skills) {
      const cur = registry.getSettings(sk.id);
      const tr = tbody.appendChild(el("tr", {}));

      // Skill name cell.
      tr.appendChild(el("td", { class: "sauce-skill-name" }, sk.id));

      // Enabled toggle.
      const enCell = tr.appendChild(el("td", { class: "col-center" }));
      const cb = enCell.appendChild(
        el("input", { type: "checkbox", class: "sauce-skill-toggle" }),
      ) as HTMLInputElement;
      cb.checked = cur.enabled;
      cb.addEventListener("change", async () => {
        const patch: Partial<SkillSettings> = { enabled: cb.checked };
        registry.setSettings(sk.id, patch);
        await this.host.setConfig(SKILL_KEY(sk.id), {
          ...registry.getSettings(sk.id),
        });
      });

      // Autonomy dropdown.
      const autoCell = tr.appendChild(el("td", { class: "col-center" }));
      const sel = autoCell.appendChild(
        el("select", { class: "dropdown sauce-skill-autonomy" }),
      ) as HTMLSelectElement;
      for (const lvl of AUTONOMY_LEVELS) {
        const opt = sel.appendChild(
          el("option", { value: lvl }, cap(lvl.replace(/-/g, " "))),
        ) as HTMLOptionElement;
        if (lvl === cur.autonomy) opt.selected = true;
      }
      sel.addEventListener("change", async () => {
        const patch: Partial<SkillSettings> = {
          autonomy: sel.value as SkillSettings["autonomy"],
        };
        registry.setSettings(sk.id, patch);
        await this.host.setConfig(SKILL_KEY(sk.id), {
          ...registry.getSettings(sk.id),
        });
        rerender();
      });

      // Description.
      const descCell = tr.appendChild(el("td", { class: "sauce-skill-desc" }));
      descCell.textContent = sk.description ?? "";
    }
  }
}
