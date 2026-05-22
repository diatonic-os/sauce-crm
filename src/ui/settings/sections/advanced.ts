import { Setting, Notice } from "obsidian";
import type SauceGraphPlugin from "../../../main";

function markAdvanced(set: Setting): Setting {
  set.settingEl.addClass("sg-advanced");
  return set;
}

export function renderAdvanced(containerEl: HTMLElement, plugin: SauceGraphPlugin): void {
  plugin.logger?.debug?.("settings.section_render", { section: "advanced" });
  const s: any = plugin.settings as any;

  containerEl.createEl("h3", { text: "Security & diagnostics" });

  new Setting(containerEl)
    .setName("Master password")
    .setDesc("Set, change, or forget the master password protecting local secrets.")
    .addButton((b) => b.setButtonText("Manage…").onClick(() => {
      new Notice("Master password manager not yet wired (placeholder modal).");
    }));

  new Setting(containerEl)
    .setName("Auto-lock (minutes)")
    .setDesc("Lock secrets after this many minutes of inactivity.")
    .addSlider((sl) => sl
      .setLimits(1, 240, 1)
      .setDynamicTooltip()
      .setValue(typeof s.autoLockMinutes === "number" ? s.autoLockMinutes : 15)
      .onChange(async (v) => { s.autoLockMinutes = v; await plugin.saveSettings(); }));

  new Setting(containerEl)
    .setName("Diagnostics")
    .setDesc("Enable in-app diagnostics panel.")
    .addToggle((t) => t
      .setValue(s.diagnostics === true)
      .onChange(async (v) => { s.diagnostics = v; await plugin.saveSettings(); }));

  containerEl.createEl("h3", { text: "Advanced" });

  markAdvanced(new Setting(containerEl)
    .setName("Verify audit chain")
    .setDesc("Check the integrity of the tamper-evident audit log.")
    .addButton((b) => b.setButtonText("Verify").onClick(async () => {
      try {
        const res = await (plugin.v2 as any)?.auditLog?.verifyChain?.();
        if (res === undefined) new Notice("Audit log not available.");
        else if (res === true || res?.ok === true) new Notice("Audit chain OK.");
        else new Notice(`Audit chain failed: ${JSON.stringify(res)}`);
      } catch (e: any) {
        new Notice(`Verify failed: ${e?.message ?? e}`);
      }
    })));

  markAdvanced(new Setting(containerEl)
    .setName("Proxy mode")
    .setDesc("Route AI/integration traffic through your proxy.")
    .addToggle((t) => t
      .setValue(s.proxyMode === true)
      .onChange(async (v) => { s.proxyMode = v; await plugin.saveSettings(); })));

  markAdvanced(new Setting(containerEl)
    .setName("Inference tuning")
    .setDesc("Advanced inference parameters (placeholder).")
    .addButton((b) => b.setButtonText("Open…").onClick(() => {
      new Notice("Inference tuning panel not yet wired.");
    })));

  markAdvanced(new Setting(containerEl)
    .setName("CDEL idiom catalog")
    .setDesc("Browse the contract-domain expression library (placeholder).")
    .addButton((b) => b.setButtonText("Browse…").onClick(() => {
      new Notice("CDEL catalog not yet wired.");
    })));

  markAdvanced(new Setting(containerEl)
    .setName("Telemetry detail")
    .setDesc("Granularity of telemetry events collected.")
    .addDropdown((d) => d
      .addOption("off", "Off")
      .addOption("local", "Local only")
      .addOption("anonymous", "Anonymous")
      .setValue(s.telemetryDetail ?? "off")
      .onChange(async (v) => { s.telemetryDetail = v; await plugin.saveSettings(); })));

  markAdvanced(new Setting(containerEl)
    .setName("Log level")
    .setDesc("Verbosity of plugin logs.")
    .addDropdown((d) => d
      .addOption("error", "Error")
      .addOption("warn", "Warn")
      .addOption("info", "Info")
      .addOption("debug", "Debug")
      .addOption("trace", "Trace")
      .setValue(s.logLevel ?? "info")
      .onChange(async (v) => { s.logLevel = v; await plugin.saveSettings(); })));

  markAdvanced(new Setting(containerEl)
    .setName("Dev mode")
    .setDesc("Enable developer tools and unstable surfaces.")
    .addToggle((t) => t
      .setValue(s.devMode === true)
      .onChange(async (v) => { s.devMode = v; await plugin.saveSettings(); })));

  markAdvanced(new Setting(containerEl)
    .setName("Experimental flags")
    .setDesc("Comma-separated flag names to enable.")
    .addTextArea((t) => t
      .setValue(Array.isArray(s.experimentalFlags) ? s.experimentalFlags.join(", ") : (s.experimentalFlags ?? ""))
      .onChange(async (v) => {
        s.experimentalFlags = v.split(",").map((x) => x.trim()).filter(Boolean);
        await plugin.saveSettings();
      })));

  // About panel
  const about = containerEl.createDiv({ cls: "sg-about-panel sg-advanced" });
  about.createEl("h4", { text: "About" });
  const version = (plugin as any).manifest?.version ?? "unknown";
  const id = (plugin as any).manifest?.id ?? "sauce-graph";
  about.createEl("p", { text: `${id} v${version}` });
}
