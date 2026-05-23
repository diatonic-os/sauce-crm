// Obsidian-side host for PluginConfigService. Detects installed plugins via the
// (non-public) app.plugins / app.internalPlugins surfaces and reads/writes their
// settings JSON through the vault adapter. Community plugin config lives at
// `<configDir>/plugins/<id>/data.json`; core (internal) plugin config at
// `<configDir>/<id>.json`. Backups are written into the vault so they're
// portable and visible (not a host-specific target).
//
// Note: Obsidian does not hot-reload a plugin's settings when its data.json is
// changed externally — the change takes effect on next plugin load / reload.

import type { App } from "obsidian";
import type { PluginConfigHost, PluginKind } from "./PluginConfigService";

interface AppPluginsSurface {
  plugins?: { manifests?: Record<string, unknown>; enabledPlugins?: Set<string> };
  internalPlugins?: {
    plugins?: Record<string, { enabled?: boolean }>;
    config?: Record<string, boolean>;
    getEnabledPluginById?: (id: string) => unknown;
  };
}

export class ObsidianPluginConfigHost implements PluginConfigHost {
  constructor(private readonly app: App, private readonly backupDir = "_Plugin-Config/_backups") {}

  private get configDir(): string { return this.app.vault.configDir; }

  private pathFor(id: string, kind: PluginKind): string {
    return kind === "community"
      ? `${this.configDir}/plugins/${id}/data.json`
      : `${this.configDir}/${id}.json`;
  }

  isInstalled(id: string, kind: PluginKind): boolean {
    const a = this.app as unknown as AppPluginsSurface;
    if (kind === "community") return !!a.plugins?.manifests?.[id];
    // Core/internal plugins are always present; treat "installed" as enabled.
    const ip = a.internalPlugins;
    if (ip?.getEnabledPluginById) return !!ip.getEnabledPluginById(id);
    if (ip?.config && id in ip.config) return ip.config[id] === true;
    return !!ip?.plugins?.[id]?.enabled;
  }

  async readConfig(id: string, kind: PluginKind): Promise<Record<string, unknown> | null> {
    const p = this.pathFor(id, kind);
    try {
      if (await this.app.vault.adapter.exists(p)) {
        return JSON.parse(await this.app.vault.adapter.read(p)) as Record<string, unknown>;
      }
    } catch { /* unreadable / malformed → treat as absent */ }
    return null;
  }

  async writeConfig(id: string, kind: PluginKind, data: Record<string, unknown>): Promise<void> {
    await this.app.vault.adapter.write(this.pathFor(id, kind), JSON.stringify(data, null, 2));
  }

  async backupConfig(id: string, kind: PluginKind, data: Record<string, unknown> | null): Promise<void> {
    if (data == null) return; // nothing to back up (plugin had no config yet)
    const dir = this.backupDir;
    try { if (!(await this.app.vault.adapter.exists(dir))) await this.app.vault.adapter.mkdir(dir); } catch { /* */ }
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    await this.app.vault.adapter.write(`${dir}/${id}.${kind}.${ts}.json`, JSON.stringify(data, null, 2));
  }
}
