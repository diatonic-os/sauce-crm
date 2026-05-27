import { Setting } from "obsidian";
import type SauceGraphPlugin from "../../../main";

function markAdvanced(set: Setting): Setting {
  set.settingEl.addClass("sg-advanced");
  return set;
}

export function renderContracts(
  containerEl: HTMLElement,
  plugin: SauceGraphPlugin,
): void {
  plugin.logger?.debug?.("settings.section_render", { section: "contracts" });
  containerEl.createEl("h3", { text: "Contracts" });

  new Setting(containerEl)
    .setName("Save-time checks")
    .setDesc(
      "What to do when a note doesn't match its contract (technical: strictness).",
    )
    .addDropdown((d) =>
      d
        .addOption("block", "Block — refuse to save")
        .addOption("warn", "Warn — save but notify")
        .addOption("log", "Log — save silently")
        .setValue(plugin.settings.strictness ?? "warn")
        .onChange(async (v) => {
          plugin.settings.strictness = v as "block" | "warn" | "log";
          await plugin.saveSettings();
        }),
    );

  new Setting(containerEl)
    .setName("Match strictness")
    .setDesc(
      "How similar two contacts must be before suggesting a link (technical: ρ_adm).",
    )
    .addSlider((s) =>
      s
        .setLimits(0, 1, 0.05)
        .setDynamicTooltip()
        .setValue(plugin.settings.compat_config?.rho_adm ?? 0.7)
        .onChange(async (v) => {
          plugin.settings.compat_config.rho_adm = v;
          await plugin.saveSettings();
        }),
    );

  containerEl.createEl("h3", { text: "Advanced" });

  markAdvanced(
    new Setting(containerEl)
      .setName("Per-field weights")
      .setDesc(
        "Compatibility field weights (technical: w_i per field, comma-separated key=value pairs).",
      )
      .addText((t) => {
        const cfg = plugin.settings.compat_config as unknown as { weights?: Record<string, unknown> };
        const weights: Record<string, unknown> = cfg.weights ?? {};
        const initial = Object.entries(weights)
          .map(([k, v]) => `${k}=${v}`)
          .join(", ");
        t.setValue(initial).onChange(async (v) => {
          const out: Record<string, number> = {};
          for (const pair of v
            .split(",")
            .map((x) => x.trim())
            .filter(Boolean)) {
            const [k, val] = pair.split("=").map((x) => x.trim());
            const n = Number(val);
            if (k && Number.isFinite(n)) out[k] = n;
          }
          (cfg as Record<string, unknown>).weights = out;
          await plugin.saveSettings();
        });
      }),
  );

  markAdvanced(
    new Setting(containerEl)
      .setName("Grammar level")
      .setDesc(
        "Which contract grammar tier to enforce (technical: contract grammar level).",
      )
      .addDropdown((d) => {
        const cfg = plugin.settings as unknown as Record<string, unknown>;
        d.addOption("core", "Core")
          .addOption("simple", "Simple")
          .addOption("full", "Full")
          .setValue(typeof cfg.grammarLevel === "string" ? cfg.grammarLevel : "simple")
          .onChange(async (v) => {
            cfg.grammarLevel = v;
            await plugin.saveSettings();
          });
      }),
  );

  markAdvanced(
    new Setting(containerEl)
      .setName("Propositional: AND required")
      .setDesc("Require all clauses to hold (technical: propositional AND).")
      .addToggle((t) => {
        const cfg = plugin.settings as unknown as Record<string, unknown>;
        t.setValue(cfg.propAndRequired === true).onChange(async (v) => {
          cfg.propAndRequired = v;
          await plugin.saveSettings();
        });
      }),
  );

  markAdvanced(
    new Setting(containerEl)
      .setName("Propositional: OR allowed")
      .setDesc(
        "Permit alternative clause sets to satisfy contract (technical: propositional OR).",
      )
      .addToggle((t) => {
        const cfg = plugin.settings as unknown as Record<string, unknown>;
        t.setValue(cfg.propOrAllowed !== false).onChange(async (v) => {
          cfg.propOrAllowed = v;
          await plugin.saveSettings();
        });
      }),
  );
}
