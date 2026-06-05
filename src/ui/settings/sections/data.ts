import { Setting, Notice } from "obsidian";
import type SauceGraphPlugin from "../../../main";

function markAdvanced(set: Setting): Setting {
  set.settingEl.addClass("sg-advanced");
  return set;
}

/** Human-friendly relative-ish timestamp for the last-index display.
 *  Falls back to the raw ISO string when it can't be parsed.
 *  Exported for unit testing (the DOM render path needs Obsidian's element
 *  extensions, which aren't available under jsdom). */
export function formatWhen(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return iso;
  const deltaMs = Date.now() - t;
  const mins = Math.floor(deltaMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(t).toISOString().slice(0, 10);
}

/** Persisted full-vault index state, as stored on settings.lancedbIndexState. */
export interface IndexStateView {
  cursor: number;
  total: number;
  synced?: number;
  completedAt?: string;
  drift?: number | null;
  mirrorRows?: number | null;
}

/** Pure description of the last-index stats line + whether it represents drift.
 *  Extracted from the render path so the reconciliation/drift display logic is
 *  unit-testable without Obsidian's DOM element extensions. */
export function describeIndexState(idx: IndexStateView | undefined): {
  text: string;
  drift: boolean;
} {
  if (!idx || (idx.completedAt == null && idx.cursor === 0)) {
    return {
      text: "Vault index: not yet built. Use Rebuild vault index above.",
      drift: false,
    };
  }
  if (idx.completedAt == null) {
    return {
      text: `Vault index: interrupted at ${idx.cursor}/${idx.total} — rebuild to resume.`,
      drift: false,
    };
  }
  const when = formatWhen(idx.completedAt);
  const synced = idx.synced ?? idx.total;
  let text = `Vault index: ${synced} entit${synced === 1 ? "y" : "ies"}, last built ${when}.`;
  let drift = false;
  if (idx.drift != null) {
    if (idx.drift === 0) {
      text += " Mirror reconciled (no drift).";
    } else {
      text += ` Drift ${idx.drift} (${synced} vault vs ${idx.mirrorRows ?? "?"} mirror rows) — rebuild to reconcile.`;
      drift = true;
    }
  }
  return { text, drift };
}

function runCommand(plugin: SauceGraphPlugin, id: string): boolean {
  // app.commands is ambient-typed in src/types/obsidian-augment.ts
  return !!plugin.app.commands?.executeCommandById?.(id);
}

export function renderData(
  containerEl: HTMLElement,
  plugin: SauceGraphPlugin,
): void {
  plugin.logger?.debug?.("settings.section_render", { section: "data" });
  const s = plugin.settings as unknown as Record<string, unknown>;

  containerEl.createEl("h3", { text: "Data" });

  new Setting(containerEl)
    .setName("Backup schedule")
    .setDesc("Automatic vault backups.")
    .addDropdown((d) =>
      d
        .addOption("off", "Off")
        .addOption("daily", "Daily")
        .addOption("weekly", "Weekly")
        .setValue(
          typeof s.backupSchedule === "string" ? s.backupSchedule : "off",
        )
        .onChange(async (v) => {
          s.backupSchedule = v;
          await plugin.saveSettings();
        }),
    );

  new Setting(containerEl)
    .setName("Import")
    .setDesc("Import contacts from external sources.")
    .addButton((b) =>
      b.setButtonText("Import…").onClick(() => {
        if (!runCommand(plugin, "sauce-graph:import")) {
          new Notice("Import command unavailable.");
        }
      }),
    );

  new Setting(containerEl)
    .setName("Export")
    .setDesc("Export your graph as JSON.")
    .addButton((b) =>
      b.setButtonText("Export…").onClick(() => {
        if (!runCommand(plugin, "sauce-graph:export-graph-json")) {
          new Notice("Export command unavailable.");
        }
      }),
    );

  const syncRt = plugin.v2?.sync as unknown as
    | {
        isRunning?(): boolean;
        start?(): Promise<void>;
        stop?(): Promise<void>;
      }
    | null
    | undefined;
  if (syncRt) {
    new Setting(containerEl)
      .setName("Sync")
      .setDesc("Master sync toggle for external integrations.")
      .addToggle((t) => {
        const running =
          typeof syncRt.isRunning === "function"
            ? syncRt.isRunning()
            : s.syncEnabled === true;
        t.setValue(running).onChange(async (v) => {
          try {
            if (v) await syncRt.start?.();
            else await syncRt.stop?.();
            s.syncEnabled = v;
            await plugin.saveSettings();
          } catch (e: unknown) {
            new Notice(
              `Sync toggle failed: ${e instanceof Error ? e.message : String(e)}`,
            );
          }
        });
      });
  } else {
    const empty = containerEl.createDiv({ cls: "sg-empty-state" });
    empty.createEl("h4", { text: "Sync — coming soon" });
    empty.createEl("p", {
      text: "Master sync controls will appear when the sync runtime ships.",
    });
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
  const version = (cap?.status as unknown as { version?: string } | undefined)
    ?.version;
  const dbEnabled = cap?.enabled ?? false;

  new Setting(containerEl)
    .setName("Vector + entity store")
    .setDesc(
      "LanceDB powers semantic search, embeddings, and fast entity lookups. " +
        `Status: ${stateLabel[state] ?? state}${version ? ` (v${version})` : ""}.`,
    )
    .addButton((b) => {
      if (dbEnabled) {
        b.setButtonText("Rebuild vault index")
          .setTooltip(
            "Batched, cancellable full re-mirror + re-embed of every entity into LanceDB. " +
              "Progress shows in the status bar; safe to keep working while it runs.",
          )
          .onClick(() => {
            if (!plugin.mirrorSync) {
              new Notice("LanceDB mirror not ready.");
              return;
            }
            // Delegate to the cancellable, progress-reporting, resumable runner
            // (status-bar item + reconciliation + persisted cursor live there).
            void plugin.rebuildVaultIndex();
          });
      } else {
        b.setButtonText("Install LanceDB")
          .setCta()
          .setTooltip("Install the LanceDB native backend on this device.")
          .onClick(() => plugin.openLanceDBInstall());
      }
    });

  // ── Last-index stats + drift ────────────────────────────────────────
  // Surface the persisted index state so the operator can see when the vault
  // was last fully indexed, how many entities, and any reconciliation drift
  // (vault entities vs LanceDB mirror rows).
  if (dbEnabled) {
    const statsEl = containerEl.createDiv({ cls: "sg-index-stats" });
    const { text, drift } = describeIndexState(
      plugin.settings.lancedbIndexState,
    );
    const p = statsEl.createEl("p", {
      cls: "setting-item-description",
      text,
    });
    if (drift) p.addClass("sg-index-drift");
  }

  new Setting(containerEl)
    .setName("Index on plugin load")
    .setDesc(
      "Mirror every existing entity into LanceDB when the plugin starts (fast — embeddings append on change or via Reindex).",
    )
    .addToggle((t) =>
      t
        .setValue(s.lancedbIndexOnLoad !== false)
        .setDisabled(!dbEnabled)
        .onChange(async (v) => {
          s.lancedbIndexOnLoad = v;
          await plugin.saveSettings();
        }),
    );

  new Setting(containerEl)
    .setName("Realtime embeddings")
    .setDesc(
      "Re-embed entities as you edit them. Off = embeddings only update on manual Reindex (lower CPU).",
    )
    .addToggle((t) =>
      t
        .setValue(plugin.settings.features?.rag?.realtimeEmbeddings ?? false)
        .setDisabled(!dbEnabled)
        .onChange(async (v) => {
          if (plugin.settings.features?.rag) {
            plugin.settings.features.rag.realtimeEmbeddings = v;
            await plugin.saveSettings();
          }
        }),
    );

  containerEl.createEl("h3", { text: "Advanced" });

  markAdvanced(
    new Setting(containerEl)
      .setName("Geocode provider")
      .setDesc("Service used to resolve addresses to coordinates.")
      .addDropdown((d) =>
        d
          .addOption("nominatim", "Nominatim (OSM)")
          .addOption("google", "Google")
          .addOption("mapbox", "Mapbox")
          .addOption("none", "Disabled")
          .setValue(
            typeof s.geocodeProvider === "string"
              ? s.geocodeProvider
              : "nominatim",
          )
          .onChange(async (v) => {
            s.geocodeProvider = v;
            await plugin.saveSettings();
          }),
      ),
  );

  markAdvanced(
    new Setting(containerEl)
      .setName("Conflict policy")
      .setDesc("How to resolve sync conflicts.")
      .addDropdown((d) =>
        d
          .addOption("vault_wins", "Vault wins")
          .addOption("external_wins", "External wins")
          .addOption("latest_wins", "Latest timestamp wins")
          .addOption("prompt", "Prompt me")
          .setValue(
            typeof s.conflictPolicy === "string"
              ? s.conflictPolicy
              : "vault_wins",
          )
          .onChange(async (v) => {
            s.conflictPolicy = v;
            await plugin.saveSettings();
          }),
      ),
  );

  markAdvanced(
    new Setting(containerEl)
      .setName("Map tile provider")
      .setDesc("Tile source for the map view.")
      .addDropdown((d) =>
        d
          .addOption("osm", "OpenStreetMap")
          .addOption("carto", "Carto")
          .addOption("mapbox", "Mapbox")
          .setValue(
            typeof s.mapTileProvider === "string" ? s.mapTileProvider : "osm",
          )
          .onChange(async (v) => {
            s.mapTileProvider = v;
            await plugin.saveSettings();
          }),
      ),
  );
}
