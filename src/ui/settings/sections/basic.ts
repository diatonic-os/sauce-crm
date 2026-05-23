import { Setting, Notice } from "obsidian";
import type SauceGraphPlugin from "../../../main";

function markAdvanced(set: Setting): Setting {
  set.settingEl.addClass("sg-advanced");
  return set;
}

function runCommand(plugin: SauceGraphPlugin, id: string): void {
  const cmds: any = (plugin.app as any).commands;
  if (cmds && typeof cmds.executeCommandById === "function") {
    cmds.executeCommandById(id);
  } else {
    new Notice(`Command unavailable: ${id}`);
  }
}

export function renderBasic(containerEl: HTMLElement, plugin: SauceGraphPlugin): void {
  plugin.logger?.debug?.("settings.section_render", { section: "basic" });
  const s: any = plugin.settings as any;

  // First-run banner
  if (s.hasDismissedFirstRun !== true && s.hasInitialized !== true) {
    const banner = containerEl.createDiv({ cls: "sg-first-run-banner" });
    const head = banner.createDiv({ cls: "sg-first-run-head" });
    head.createEl("h3", { text: "Welcome to Sauce Graph" });
    const dismiss = head.createEl("button", { text: "×", cls: "sg-first-run-dismiss" });
    dismiss.onclick = async () => {
      s.hasDismissedFirstRun = true;
      await plugin.saveSettings();
      banner.remove();
    };
    banner.createEl("p", {
      text: "Get started by bootstrapping your vault structure. This creates the folders for people, organizations, touches, notes, ideas, observations, tasks, events, ledger entries, pipeline deals, and your $user workspace.",
    });
    const startBtn = banner.createEl("button", { text: "Start", cls: "mod-cta" });
    startBtn.onclick = async () => {
      try {
        await plugin.bootstrap?.ensure?.();
        s.hasInitialized = true;
        await plugin.saveSettings();
        new Notice("Sauce Graph initialized.");
        banner.remove();
      } catch (e: any) {
        new Notice(`Bootstrap failed: ${e?.message ?? e}`);
      }
    };
  }

  // Stats strip
  containerEl.createEl("h3", { text: "At a glance" });
  const stats = containerEl.createDiv({ cls: "sg-stats-strip" });
  const peopleCount = plugin.entityService?.allPeople?.()?.length ?? 0;
  const orgsCount = plugin.entityService?.allOrgs?.()?.length ?? 0;
  const touchesCount = plugin.entityService?.allTouches?.()?.length ?? 0;
  const mkStat = (label: string, value: number, commandId: string) => {
    const cell = stats.createDiv({ cls: "sg-stat-cell" });
    cell.createEl("div", { cls: "sg-stat-value", text: String(value) });
    cell.createEl("div", { cls: "sg-stat-label", text: label });
    cell.style.cursor = "pointer";
    cell.onclick = () => runCommand(plugin, commandId);
  };
  mkStat("People", peopleCount, "sauce-graph:open-dashboard");
  mkStat("Organizations", orgsCount, "sauce-graph:open-dashboard");
  mkStat("Touches", touchesCount, "sauce-graph:open-dashboard");

  // Quick actions
  containerEl.createEl("h3", { text: "Quick actions" });
  const actions = containerEl.createDiv({ cls: "sg-quick-actions" });
  const mkBtn = (label: string, commandId: string) => {
    const b = actions.createEl("button", { text: label });
    b.onclick = () => runCommand(plugin, commandId);
  };
  mkBtn("New Person", "sauce-graph:new-person");
  mkBtn("Log Touch", "sauce-graph:log-touch");
  mkBtn("Open Dashboard", "sauce-graph:open-dashboard");

  // Default-visible settings
  containerEl.createEl("h3", { text: "Settings" });

  new Setting(containerEl)
    .setName("Vault name")
    .setDesc("Display name used in banners and exports.")
    .addText((t) => t
      .setValue(s.vaultName ?? "")
      .onChange(async (v) => { s.vaultName = v; await plugin.saveSettings(); }));

  const cadenceEnum: string[] = (plugin.settings.enums as any)?.cadence ?? ["weekly", "monthly", "quarterly", "annual"];
  new Setting(containerEl)
    .setName("Default cadence")
    .setDesc("How often you'd like to keep in touch with new contacts by default.")
    .addDropdown((d) => {
      for (const c of cadenceEnum) d.addOption(c, c);
      d.setValue(s.defaultCadence ?? cadenceEnum[0])
        .onChange(async (v) => { s.defaultCadence = v; await plugin.saveSettings(); });
    });

  new Setting(containerEl)
    .setName("Language")
    .setDesc("Interface language.")
    .addDropdown((d) => d
      .addOption("en", "English")
      .addOption("es", "Español")
      .addOption("fr", "Français")
      .setValue(s.language ?? "en")
      .onChange(async (v) => { s.language = v; await plugin.saveSettings(); }));

  new Setting(containerEl)
    .setName("Telemetry")
    .setDesc("Send anonymous usage statistics. Off by default.")
    .addToggle((t) => t
      .setValue(s.telemetry === true)
      .onChange(async (v) => { s.telemetry = v; await plugin.saveSettings(); }));

  // Advanced
  containerEl.createEl("h3", { text: "Advanced" });

  markAdvanced(new Setting(containerEl)
    .setName("Debug logging")
    .setDesc("Verbose log output to console.")
    .addToggle((t) => t
      .setValue(s.debugLogging === true)
      .onChange(async (v) => { s.debugLogging = v; await plugin.saveSettings(); })));

  markAdvanced(new Setting(containerEl)
    .setName("Reset all settings")
    .setDesc("Restore plugin defaults. Vault data is not touched.")
    .addButton((b) => b.setButtonText("Reset…").setWarning().onClick(async () => {
      const ok = (window as any).confirm?.("Reset all plugin settings to defaults? Vault files are not deleted.");
      if (!ok) return;
      try {
        await (plugin as any).resetSettings?.();
        new Notice("Settings reset.");
      } catch {
        new Notice("Reset not yet wired; manual file edit required.");
      }
    })));
}
