import { Setting, Notice } from "obsidian";
import type SauceGraphPlugin from "../../../main";

function markAdvanced(set: Setting): Setting {
  set.settingEl.addClass("sg-advanced");
  return set;
}

function runCommand(plugin: SauceGraphPlugin, id: string): boolean {
  const cmds: any = (plugin.app as any).commands;
  if (cmds && typeof cmds.executeCommandById === "function") {
    return !!cmds.executeCommandById(id);
  }
  return false;
}

export function renderData(containerEl: HTMLElement, plugin: SauceGraphPlugin): void {
  plugin.logger?.debug?.("settings.section_render", { section: "data" });
  const s: any = plugin.settings as any;

  containerEl.createEl("h3", { text: "Data" });

  new Setting(containerEl)
    .setName("Backup schedule")
    .setDesc("Automatic vault backups.")
    .addDropdown((d) => d
      .addOption("off", "Off")
      .addOption("daily", "Daily")
      .addOption("weekly", "Weekly")
      .setValue(s.backupSchedule ?? "off")
      .onChange(async (v) => { s.backupSchedule = v; await plugin.saveSettings(); }));

  new Setting(containerEl)
    .setName("Import")
    .setDesc("Import contacts from external sources.")
    .addButton((b) => b.setButtonText("Import…").onClick(() => {
      if (!runCommand(plugin, "sauce-graph:import")) {
        new Notice("Import command unavailable.");
      }
    }));

  new Setting(containerEl)
    .setName("Export")
    .setDesc("Export your graph as JSON.")
    .addButton((b) => b.setButtonText("Export…").onClick(() => {
      if (!runCommand(plugin, "sauce-graph:export-graph-json")) {
        new Notice("Export command unavailable.");
      }
    }));

  const syncRt: any = plugin.v2?.sync;
  if (syncRt) {
    new Setting(containerEl)
      .setName("Sync")
      .setDesc("Master sync toggle for external integrations.")
      .addToggle((t) => {
        const running = typeof syncRt.isRunning === "function" ? syncRt.isRunning() : (s.syncEnabled === true);
        t.setValue(running).onChange(async (v) => {
          try {
            if (v) await syncRt.start?.();
            else await syncRt.stop?.();
            s.syncEnabled = v;
            await plugin.saveSettings();
          } catch (e: any) {
            new Notice(`Sync toggle failed: ${e?.message ?? e}`);
          }
        });
      });
  } else {
    const empty = containerEl.createDiv({ cls: "sg-empty-state" });
    empty.createEl("h4", { text: "Sync — coming soon" });
    empty.createEl("p", { text: "Master sync controls will appear when the sync runtime ships." });
    empty.createEl("span", { cls: "sg-phase-pill", text: "Phase P11" });
  }

  containerEl.createEl("h3", { text: "Advanced" });

  const backendKind = plugin.v2?.backendKind ?? "unknown";
  markAdvanced(new Setting(containerEl)
    .setName("SQLite backend")
    .setDesc(`Current backend: ${backendKind}`)
    .addButton((b) => b.setButtonText("Refresh").onClick(() => {
      new Notice(`Backend: ${plugin.v2?.backendKind ?? "unknown"}`);
    })));

  markAdvanced(new Setting(containerEl)
    .setName("Vacuum database")
    .setDesc("Compact the SQLite database. Safe to run while idle.")
    .addButton((b) => b.setButtonText("Vacuum").onClick(async () => {
      try {
        await (plugin.v2 as any)?.db?.vacuum?.();
        new Notice("Vacuum complete.");
      } catch (e: any) {
        new Notice(`Vacuum failed: ${e?.message ?? e}`);
      }
    })));

  markAdvanced(new Setting(containerEl)
    .setName("Geocode provider")
    .setDesc("Service used to resolve addresses to coordinates.")
    .addDropdown((d) => d
      .addOption("nominatim", "Nominatim (OSM)")
      .addOption("google", "Google")
      .addOption("mapbox", "Mapbox")
      .addOption("none", "Disabled")
      .setValue(s.geocodeProvider ?? "nominatim")
      .onChange(async (v) => { s.geocodeProvider = v; await plugin.saveSettings(); })));

  markAdvanced(new Setting(containerEl)
    .setName("Conflict policy")
    .setDesc("How to resolve sync conflicts.")
    .addDropdown((d) => d
      .addOption("vault_wins", "Vault wins")
      .addOption("external_wins", "External wins")
      .addOption("latest_wins", "Latest timestamp wins")
      .addOption("prompt", "Prompt me")
      .setValue(s.conflictPolicy ?? "vault_wins")
      .onChange(async (v) => { s.conflictPolicy = v; await plugin.saveSettings(); })));

  markAdvanced(new Setting(containerEl)
    .setName("Map tile provider")
    .setDesc("Tile source for the map view.")
    .addDropdown((d) => d
      .addOption("osm", "OpenStreetMap")
      .addOption("carto", "Carto")
      .addOption("mapbox", "Mapbox")
      .setValue(s.mapTileProvider ?? "osm")
      .onChange(async (v) => { s.mapTileProvider = v; await plugin.saveSettings(); })));
}
