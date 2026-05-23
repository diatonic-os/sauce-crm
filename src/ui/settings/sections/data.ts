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

  // ── Database (LanceDB) ──────────────────────────────────────────────
  // LanceDB is the native vector + entity store (it replaced the former
  // SQLite backend). When uninstalled the plugin runs graph-RAG-only; the
  // Install button surfaces the host-install flow and Reindex rebuilds the
  // mirror + embeddings.
  containerEl.createEl("h3", { text: "Database (LanceDB)" });

  const cap = plugin.lancedbCapability;
  const state = cap?.status?.state ?? "unknown";
  const stateLabel: Record<string, string> = {
    available: "Installed & active",
    unavailable: "Not installed",
    "mobile-unsupported": "Not supported on mobile",
  };
  const version = (cap?.status as any)?.version as string | undefined;
  const dbEnabled = cap?.enabled ?? false;

  new Setting(containerEl)
    .setName("Vector + entity store")
    .setDesc(
      "LanceDB powers semantic search, embeddings, and fast entity lookups. " +
      `Status: ${stateLabel[state] ?? state}${version ? ` (v${version})` : ""}.`,
    )
    .addButton((b) => {
      if (dbEnabled) {
        b.setButtonText("Reindex vault")
          .setTooltip("Re-mirror and re-embed every entity into LanceDB.")
          .onClick(async () => {
            if (!plugin.mirrorSync) { new Notice("LanceDB mirror not ready."); return; }
            new Notice("Reindexing vault into LanceDB…");
            try {
              const n = await plugin.mirrorSync.fullResync({ embed: true });
              new Notice(`Reindexed ${n} entit${n === 1 ? "y" : "ies"} into LanceDB.`);
            } catch (e: any) {
              new Notice(`Reindex failed: ${e?.message ?? e}`);
            }
          });
      } else {
        b.setButtonText("Install LanceDB")
          .setCta()
          .setTooltip("Install the LanceDB native backend on this device.")
          .onClick(() => plugin.openLanceDBInstall());
      }
    });

  new Setting(containerEl)
    .setName("Index on plugin load")
    .setDesc("Mirror every existing entity into LanceDB when the plugin starts (fast — embeddings append on change or via Reindex).")
    .addToggle((t) => t
      .setValue(s.lancedbIndexOnLoad !== false)
      .setDisabled(!dbEnabled)
      .onChange(async (v) => { s.lancedbIndexOnLoad = v; await plugin.saveSettings(); }));

  new Setting(containerEl)
    .setName("Realtime embeddings")
    .setDesc("Re-embed entities as you edit them. Off = embeddings only update on manual Reindex (lower CPU).")
    .addToggle((t) => t
      .setValue(plugin.settings.features?.rag?.realtimeEmbeddings ?? false)
      .setDisabled(!dbEnabled)
      .onChange(async (v) => {
        if (plugin.settings.features?.rag) {
          plugin.settings.features.rag.realtimeEmbeddings = v;
          await plugin.saveSettings();
        }
      }));

  containerEl.createEl("h3", { text: "Advanced" });

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
