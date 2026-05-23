import { Setting } from "obsidian";
import type SauceGraphPlugin from "../../../main";
import type { VaultPaths } from "../../../services/EntityService";

function markAdvanced(set: Setting): Setting {
  set.settingEl.addClass("sg-advanced");
  return set;
}

type PathKey = keyof VaultPaths;

function pathSetting(
  containerEl: HTMLElement,
  plugin: SauceGraphPlugin,
  key: PathKey,
  name: string,
  desc: string,
): Setting {
  return new Setting(containerEl)
    .setName(name)
    .setDesc(desc)
    .addText((t) => t
      .setValue((plugin.settings.paths as any)[key] ?? "")
      .onChange(async (v) => {
        (plugin.settings.paths as any)[key] = v;
        await plugin.saveSettings();
        if (plugin.entityService && (plugin.entityService as any).paths) {
          (plugin.entityService as any).paths = plugin.settings.paths;
        }
      }));
}

export function renderVault(containerEl: HTMLElement, plugin: SauceGraphPlugin): void {
  plugin.logger?.debug?.("settings.section_render", { section: "vault" });
  containerEl.createEl("h3", { text: "Core CRM folders" });

  pathSetting(containerEl, plugin, "people", "People folder", "Where person notes are stored.");
  pathSetting(containerEl, plugin, "orgs", "Organizations folder", "Where organization notes are stored.");
  pathSetting(containerEl, plugin, "touches", "Touches folder", "Where touch logs (interactions) are stored.");

  containerEl.createEl("h3", { text: "User workspace folders" });

  pathSetting(containerEl, plugin, "notes", "Notes folder", "Where modal-captured knowledge notes are stored.");
  pathSetting(containerEl, plugin, "ideas", "Ideas folder", "Where ideas, hypotheses, and next-action seeds are stored.");
  pathSetting(containerEl, plugin, "observations", "Observations folder", "Where relationship, opportunity, risk, timing, access, and pattern signals are stored.");
  pathSetting(containerEl, plugin, "tasks", "Tasks folder", "Where follow-ups and internal tasks are stored.");
  pathSetting(containerEl, plugin, "events", "Events folder", "Where meetings, calendar events, interviews, and planning events are stored.");
  pathSetting(containerEl, plugin, "ledger", "Ledger folder", "Where ERP-lite ledger entries, commitments, AR/AP notes, and relationship balances are stored.");
  pathSetting(containerEl, plugin, "pipeline", "Pipeline folder", "Where pipeline deal and opportunity records are stored.");

  containerEl.createEl("h3", { text: "Advanced paths" });

  markAdvanced(pathSetting(containerEl, plugin, "addenda", "Addenda folder", "Schema addenda and contract overlays."));
  markAdvanced(pathSetting(containerEl, plugin, "templates", "Templates folder", "Markdown templates used by Sauce commands."));
  markAdvanced(pathSetting(containerEl, plugin, "playbooks", "Playbooks folder", "Playbook scripts."));
  markAdvanced(pathSetting(containerEl, plugin, "user", "User profile folder", "Where your $user note lives."));
  markAdvanced(pathSetting(containerEl, plugin, "vaults", "Vaults registry path", "Federation vault registry location."));

  containerEl.createEl("h3", { text: "Federation rules" });
  new Setting(containerEl)
    .setName("Validation gate")
    .setDesc("How strictly to validate federated writes.")
    .addDropdown((d) => d
      .addOption("strict", "Strict")
      .addOption("warn", "Warn")
      .addOption("off", "Off")
      .setValue(plugin.settings.federation?.validation_gate ?? "warn")
      .onChange(async (v) => {
        plugin.settings.federation.validation_gate = v as any;
        await plugin.saveSettings();
      }));
}
