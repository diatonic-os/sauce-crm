import { describe, expect, it, vi } from "vitest";
import {
  TasksAdapter,
  SAUCE_TASKS_PROFILE,
  TASKS_PLUGIN_ID,
  type TasksApiV1,
  type TasksRuntimeHost,
  type SauceTasksFacade,
} from "../../../src/integrations/obsidian/TasksAdapter";
import {
  PluginConfigService,
  type PluginConfigHost,
  type PluginKind,
} from "../../../src/services/PluginConfigService";

// In-memory PluginConfigHost — one plugin's data.json.
function memHost(initial: Record<string, unknown> | null): PluginConfigHost & {
  data: Record<string, unknown> | null;
} {
  let data = initial;
  return {
    get data() {
      return data;
    },
    isInstalled: (_id: string, _k: PluginKind) => data !== null,
    readConfig: async () => (data ? { ...data } : null),
    writeConfig: async (_id, _k, d) => {
      data = { ...d };
    },
    backupConfig: async () => {},
  };
}

function runtime(over: Partial<TasksRuntimeHost> = {}): TasksRuntimeHost {
  return {
    isEnabled: () => true,
    getVersion: () => "7.0.0",
    getApiV1: () => null,
    ...over,
  };
}

describe("TasksAdapter — IObsidianPluginIntegration surface", () => {
  it("identifies as the community tasks plugin", () => {
    const a = new TasksAdapter(
      new PluginConfigService(memHost(null), [SAUCE_TASKS_PROFILE]),
      runtime(),
    );
    expect(a.pluginId).toBe(TASKS_PLUGIN_ID);
    expect(a.pluginClass).toBe("community");
    expect(a.supportsBeta()).toBe(false);
  });

  it("detect() reports NOT installed when no data.json", async () => {
    const a = new TasksAdapter(
      new PluginConfigService(memHost(null), [SAUCE_TASKS_PROFILE]),
      runtime(),
    );
    const facts = await a.detect();
    expect(facts.installed).toBe(false);
  });

  it("detect() reports installed-but-unoptimized when canonical keys absent", async () => {
    const host = memHost({ someOtherKey: 1 });
    const a = new TasksAdapter(
      new PluginConfigService(host, [SAUCE_TASKS_PROFILE]),
      runtime(),
    );
    const facts = await a.detect();
    expect(facts).toMatchObject({
      installed: true,
      enabled: true,
      optimized: false,
      version: "7.0.0",
    });
  });

  it("optimize() patches data.json with the Sauce defaults, then detect() is optimized", async () => {
    const host = memHost({});
    const a = new TasksAdapter(
      new PluginConfigService(host, [SAUCE_TASKS_PROFILE]),
      runtime(),
    );
    const res = await a.optimize();
    expect(res.ok).toBe(true);
    expect(res.applied.map((c) => c.key).sort()).toEqual(
      ["dateFormat", "globalFilter", "setCreatedDate", "setDoneDate"].sort(),
    );
    // every applied change targets the plugin's data.json
    expect(
      res.applied.every((c) =>
        c.target.endsWith(`/${TASKS_PLUGIN_ID}/data.json`),
      ),
    ).toBe(true);
    expect(host.data).toMatchObject(SAUCE_TASKS_PROFILE.settings);
    expect((await a.detect()).optimized).toBe(true);
  });

  it("optimize() is idempotent — a second run applies zero changes", async () => {
    const host = memHost({});
    const a = new TasksAdapter(
      new PluginConfigService(host, [SAUCE_TASKS_PROFILE]),
      runtime(),
    );
    await a.optimize();
    const second = await a.optimize();
    expect(second.applied).toHaveLength(0);
  });

  it("getOptimizationDiff() previews changes without writing", async () => {
    const host = memHost({});
    const a = new TasksAdapter(
      new PluginConfigService(host, [SAUCE_TASKS_PROFILE]),
      runtime(),
    );
    const plan = await a.getOptimizationDiff();
    expect(plan.pluginId).toBe(TASKS_PLUGIN_ID);
    expect(plan.changes.length).toBeGreaterThan(0);
    expect(host.data).toEqual({}); // unchanged — diff is read-only
  });
});

describe("TasksAdapter — service facade (R-003 / G-010: wraps apiV1, never leaks it)", () => {
  it("wraps the documented apiV1 methods with a typed Sauce surface", async () => {
    const apiV1: TasksApiV1 = {
      createTaskLineModal: vi.fn(async () => "- [ ] new"),
      editTaskLineModal: vi.fn(async (l: string) => l + " edited"),
      executeToggleTaskDoneCommand: vi.fn((l: string) =>
        l.replace("[ ]", "[x]"),
      ),
    };
    const a = new TasksAdapter(
      new PluginConfigService(memHost({}), [SAUCE_TASKS_PROFILE]),
      runtime({ getApiV1: () => apiV1 }),
    );
    const facade = a.getServiceFacade<SauceTasksFacade>();

    expect(facade.isAvailable()).toBe(true);
    expect(await facade.createTaskLine()).toBe("- [ ] new");
    expect(await facade.editTaskLine("- [ ] x")).toBe("- [ ] x edited");
    expect(facade.toggleDone("- [ ] x", "n.md")).toBe("- [x] x");

    // G-010: the facade must NOT expose the raw apiV1 handle.
    expect((facade as unknown as { apiV1?: unknown }).apiV1).toBeUndefined();
    expect(Object.values(facade)).not.toContain(apiV1);
  });

  it("facade reports unavailable + rejects when apiV1 is absent", async () => {
    const a = new TasksAdapter(
      new PluginConfigService(memHost({}), [SAUCE_TASKS_PROFILE]),
      runtime({ getApiV1: () => null }),
    );
    const facade = a.getServiceFacade<SauceTasksFacade>();
    expect(facade.isAvailable()).toBe(false);
    await expect(facade.createTaskLine()).rejects.toThrow(/unavailable/i);
  });
});
