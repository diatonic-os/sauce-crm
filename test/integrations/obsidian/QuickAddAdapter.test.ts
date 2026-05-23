import { describe, expect, it, vi } from "vitest";
import {
  QuickAddAdapter,
  QUICKADD_PLUGIN_ID,
  SAUCE_QUICKADD_CHOICES,
  type QuickAddApi,
  type QuickAddRuntimeHost,
  type SauceQuickAddFacade,
} from "../../../src/integrations/obsidian/QuickAddAdapter";
import type {
  PluginConfigHost,
  PluginKind,
} from "../../../src/services/PluginConfigService";

function memHost(initial: Record<string, unknown> | null): PluginConfigHost & {
  data: Record<string, unknown> | null;
} {
  let data = initial;
  return {
    get data() {
      return data;
    },
    isInstalled: (_id: string, _k: PluginKind) => data !== null,
    readConfig: async () => (data ? structuredClone(data) : null),
    writeConfig: async (_id, _k, d) => {
      data = structuredClone(d);
    },
    backupConfig: async () => {},
  };
}

function runtime(over: Partial<QuickAddRuntimeHost> = {}): QuickAddRuntimeHost {
  return {
    isEnabled: () => true,
    getVersion: () => "1.0.0",
    getApi: () => null,
    ...over,
  };
}

describe("QuickAddAdapter", () => {
  it("optimize() appends the 4 sauce choices idempotently", async () => {
    const host = memHost({ choices: [{ id: "x", name: "Existing" }] });
    const a = new QuickAddAdapter(host, runtime());
    const res = await a.optimize();
    expect(res.applied).toHaveLength(4);
    const names = (host.data!.choices as Array<{ name: string }>).map(
      (c) => c.name,
    );
    expect(names).toContain("Existing"); // preserved
    for (const c of SAUCE_QUICKADD_CHOICES) expect(names).toContain(c.name);
    // idempotent
    const second = await a.optimize();
    expect(second.applied).toHaveLength(0);
    expect((host.data!.choices as unknown[]).length).toBe(5);
  });

  it("detect() optimized once all sauce choices present", async () => {
    const host = memHost({ choices: [] });
    const a = new QuickAddAdapter(host, runtime());
    expect((await a.detect()).optimized).toBe(false);
    await a.optimize();
    expect((await a.detect()).optimized).toBe(true);
  });

  it("facade.capture wraps quickadd.api.executeChoice; rejects when api absent", async () => {
    const api: QuickAddApi = { executeChoice: vi.fn(async () => {}) };
    const a = new QuickAddAdapter(
      memHost({ choices: [] }),
      runtime({ getApi: () => api }),
    );
    const f = a.getServiceFacade<SauceQuickAddFacade>();
    expect(f.listSauceChoices()).toHaveLength(4);
    await f.capture("Sauce: New Touch", { x: 1 });
    expect(api.executeChoice).toHaveBeenCalledWith("Sauce: New Touch", {
      x: 1,
    });

    const a2 = new QuickAddAdapter(
      memHost({ choices: [] }),
      runtime({ getApi: () => null }),
    );
    await expect(
      a2.getServiceFacade<SauceQuickAddFacade>().capture("x"),
    ).rejects.toThrow(/unavailable/i);
  });

  it("is the quickadd community plugin", () => {
    expect(new QuickAddAdapter(memHost({}), runtime()).pluginId).toBe(
      QUICKADD_PLUGIN_ID,
    );
  });
});
