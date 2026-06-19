import { describe, expect, it, vi } from "vitest";
import {
  PluginConfigService,
  type CanonicalProfile,
  type PluginConfigHost,
} from "../../src/services/PluginConfigService";

const PROFILE: CanonicalProfile = {
  id: "templates",
  kind: "core",
  label: "Templates",
  settings: { folder: "_templates" },
};

/** In-memory host: tracks installed plugins + their data.json, captures writes/backups. */
function fakeHost(
  opts: { installed?: boolean; config?: Record<string, unknown> | null } = {},
) {
  let config = opts.config ?? null;
  const writes: Record<string, unknown>[] = [];
  const backups: (Record<string, unknown> | null)[] = [];
  const host: PluginConfigHost = {
    isInstalled: () => opts.installed ?? true,
    readConfig: async () => config,
    writeConfig: async (_id, _k, data) => {
      writes.push(data);
      config = data;
    },
    backupConfig: async (_id, _k, data) => {
      backups.push(data);
    },
  };
  return {
    host,
    writes,
    backups,
    get config() {
      return config;
    },
  };
}

describe("PluginConfigService.status", () => {
  it("reports not-installed when the plugin is absent", async () => {
    const h = fakeHost({ installed: false });
    const svc = new PluginConfigService(h.host, [PROFILE]);
    expect((await svc.status(PROFILE)).state).toBe("not-installed");
  });

  it("reports 'installed' (unconfigured) when no canonical key is present", async () => {
    const h = fakeHost({ installed: true, config: { other: 1 } });
    const svc = new PluginConfigService(h.host, [PROFILE]);
    const st = await svc.status(PROFILE);
    expect(st.state).toBe("installed");
    expect(st.changes).toEqual([
      { key: "folder", from: undefined, to: "_templates" },
    ]);
  });

  it("reports 'configured' when all canonical keys already match", async () => {
    const h = fakeHost({
      installed: true,
      config: { folder: "_templates", other: 1 },
    });
    const svc = new PluginConfigService(h.host, [PROFILE]);
    const st = await svc.status(PROFILE);
    expect(st.state).toBe("configured");
    expect(st.changes).toEqual([]);
  });

  it("reports 'drift' when a canonical key is present but changed", async () => {
    const h = fakeHost({
      installed: true,
      config: { folder: "OtherTemplates" },
    });
    const svc = new PluginConfigService(h.host, [PROFILE]);
    const st = await svc.status(PROFILE);
    expect(st.state).toBe("drift");
    expect(st.changes).toEqual([
      { key: "folder", from: "OtherTemplates", to: "_templates" },
    ]);
  });
});

describe("PluginConfigService.apply", () => {
  it("backs up, merges canonical over current (preserving other keys), writes, returns changes", async () => {
    const h = fakeHost({
      installed: true,
      config: { folder: "Old", keepMe: 42 },
    });
    const svc = new PluginConfigService(h.host, [PROFILE]);
    const applied = await svc.apply(PROFILE);

    expect(applied).toEqual([{ key: "folder", from: "Old", to: "_templates" }]);
    expect(h.backups).toEqual([{ folder: "Old", keepMe: 42 }]); // pre-write backup
    expect(h.writes).toHaveLength(1);
    expect(h.config).toEqual({ folder: "_templates", keepMe: 42 }); // other keys preserved
  });

  it("is a no-op when already configured", async () => {
    const h = fakeHost({ installed: true, config: { folder: "_templates" } });
    const svc = new PluginConfigService(h.host, [PROFILE]);
    expect(await svc.apply(PROFILE)).toEqual([]);
    expect(h.writes).toHaveLength(0);
  });

  it("is a no-op (no write/backup) when not installed", async () => {
    const h = fakeHost({ installed: false });
    const svc = new PluginConfigService(h.host, [PROFILE]);
    expect(await svc.apply(PROFILE)).toEqual([]);
    expect(h.writes).toHaveLength(0);
    expect(h.backups).toHaveLength(0);
  });

  it("records a provenance trace on apply", async () => {
    const h = fakeHost({ installed: true, config: {} });
    const calls: { op: string; subject: string }[] = [];
    const trace = {
      record: async (op: string, subject: string) => {
        calls.push({ op, subject });
        return {};
      },
    };
    const svc = new PluginConfigService(h.host, [PROFILE], trace);
    await svc.apply(PROFILE);
    expect(calls).toEqual([
      { op: "plugin-config", subject: "plugin:templates" },
    ]);
  });

  it("applyAll returns only the plugins that needed changes", async () => {
    const installed = fakeHost({ installed: true, config: {} });
    const svc = new PluginConfigService(installed.host, [
      PROFILE,
      {
        id: "dataview",
        kind: "community",
        label: "Dataview",
        settings: { refreshEnabled: true },
      },
    ]);
    const summary = await svc.applyAll();
    expect(summary.map((s) => s.id).sort()).toEqual(["dataview", "templates"]);
  });
});
