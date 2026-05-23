import { describe, expect, it } from "vitest";
import type { App } from "obsidian";
import { ObsidianPluginConfigHost } from "../../src/services/ObsidianPluginConfigHost";

/** Fake app: in-memory adapter + plugins/internalPlugins surfaces. */
function fakeApp(opts: {
  files?: Record<string, string>;
  manifests?: Record<string, unknown>;
  coreConfig?: Record<string, boolean>;
} = {}) {
  const files: Record<string, string> = { ...(opts.files ?? {}) };
  const app = {
    vault: {
      configDir: ".obsidian",
      adapter: {
        exists: async (p: string) => p in files,
        read: async (p: string) => files[p],
        write: async (p: string, d: string) => { files[p] = d; },
        mkdir: async (_p: string) => { /* noop */ },
      },
    },
    plugins: { manifests: opts.manifests ?? {} },
    internalPlugins: { config: opts.coreConfig ?? {} },
  } as unknown as App;
  return { app, files };
}

describe("ObsidianPluginConfigHost", () => {
  it("detects community plugins via manifests", () => {
    const { app } = fakeApp({ manifests: { "obsidian-tasks-plugin": {} } });
    const h = new ObsidianPluginConfigHost(app);
    expect(h.isInstalled("obsidian-tasks-plugin", "community")).toBe(true);
    expect(h.isInstalled("dataview", "community")).toBe(false);
  });

  it("detects core plugins via internalPlugins.config", () => {
    const { app } = fakeApp({ coreConfig: { "daily-notes": true, templates: false } });
    const h = new ObsidianPluginConfigHost(app);
    expect(h.isInstalled("daily-notes", "core")).toBe(true);
    expect(h.isInstalled("templates", "core")).toBe(false);
  });

  it("reads community config from plugins/<id>/data.json", async () => {
    const { app } = fakeApp({ files: { ".obsidian/plugins/dataview/data.json": JSON.stringify({ refreshEnabled: true }) } });
    const h = new ObsidianPluginConfigHost(app);
    expect(await h.readConfig("dataview", "community")).toEqual({ refreshEnabled: true });
    expect(await h.readConfig("missing", "community")).toBeNull();
  });

  it("reads core config from <id>.json", async () => {
    const { app } = fakeApp({ files: { ".obsidian/daily-notes.json": JSON.stringify({ folder: "X" }) } });
    const h = new ObsidianPluginConfigHost(app);
    expect(await h.readConfig("daily-notes", "core")).toEqual({ folder: "X" });
  });

  it("writes config to the correct path per kind", async () => {
    const { app, files } = fakeApp();
    const h = new ObsidianPluginConfigHost(app);
    await h.writeConfig("templates", "core", { folder: "_templates" });
    await h.writeConfig("dataview", "community", { refreshEnabled: true });
    expect(JSON.parse(files[".obsidian/templates.json"])).toEqual({ folder: "_templates" });
    expect(JSON.parse(files[".obsidian/plugins/dataview/data.json"])).toEqual({ refreshEnabled: true });
  });

  it("backs up into the vault backup dir (and skips null configs)", async () => {
    const { app, files } = fakeApp();
    const h = new ObsidianPluginConfigHost(app, "_Plugin-Config/_backups");
    await h.backupConfig("dataview", "community", null); // nothing to back up
    expect(Object.keys(files).some((p) => p.startsWith("_Plugin-Config/_backups"))).toBe(false);
    await h.backupConfig("dataview", "community", { refreshEnabled: true });
    const backup = Object.keys(files).find((p) => p.startsWith("_Plugin-Config/_backups/dataview."));
    expect(backup).toBeTruthy();
    expect(JSON.parse(files[backup!])).toEqual({ refreshEnabled: true });
  });
});
