import { describe, expect, it, vi } from "vitest";
import {
  DataviewAdapter,
  SAUCE_DATAVIEW_PROFILE,
  DATAVIEW_PLUGIN_ID,
  type DataviewApi,
  type DataviewRuntimeHost,
  type SauceDataviewFacade,
} from "../../../src/integrations/obsidian/DataviewAdapter";
import {
  PluginConfigService,
  type PluginConfigHost,
  type PluginKind,
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
    readConfig: async () => (data ? { ...data } : null),
    writeConfig: async (_id, _k, d) => {
      data = { ...d };
    },
    backupConfig: async () => {},
  };
}

function runtime(over: Partial<DataviewRuntimeHost> = {}): DataviewRuntimeHost {
  return {
    isEnabled: () => true,
    getVersion: () => "0.5.0",
    getApi: () => null,
    ...over,
  };
}

describe("DataviewAdapter", () => {
  it("identifies as the dataview community plugin", () => {
    const a = new DataviewAdapter(
      new PluginConfigService(memHost(null), [SAUCE_DATAVIEW_PROFILE]),
      runtime(),
    );
    expect(a.pluginId).toBe(DATAVIEW_PLUGIN_ID);
    expect(a.pluginClass).toBe("community");
  });

  it("optimize() enables dataviewjs deterministically + registers inline resolvers", async () => {
    const host = memHost({});
    const registerInlineResolvers = vi.fn();
    const a = new DataviewAdapter(
      new PluginConfigService(host, [SAUCE_DATAVIEW_PROFILE]),
      runtime({ registerInlineResolvers }),
    );
    const res = await a.optimize();
    expect(res.ok).toBe(true);
    expect(host.data).toMatchObject({
      enableDataviewJs: true,
      dataviewJsKeyword: "dataviewjs",
    });
    expect(registerInlineResolvers).toHaveBeenCalledOnce();
    expect((await a.detect()).optimized).toBe(true);
  });

  it("detect() is unoptimized until the canonical keys are set", async () => {
    const a = new DataviewAdapter(
      new PluginConfigService(memHost({ refreshEnabled: true }), [
        SAUCE_DATAVIEW_PROFILE,
      ]),
      runtime(),
    );
    expect((await a.detect()).optimized).toBe(false);
  });

  it("facade wraps dv.api.pages/pagePaths/query without leaking the raw api (G-010)", async () => {
    const api: DataviewApi = {
      pages: vi.fn(() => [{ file: { name: "A" } }]),
      pagePaths: vi.fn(() => ["A.md", "B.md"]),
      query: vi.fn(async () => ({ successful: true })),
    };
    const a = new DataviewAdapter(
      new PluginConfigService(memHost({}), [SAUCE_DATAVIEW_PROFILE]),
      runtime({ getApi: () => api }),
    );
    const dv = a.getServiceFacade<SauceDataviewFacade>();
    expect(dv.isAvailable()).toBe(true);
    expect(dv.pages('"folder"')).toEqual([{ file: { name: "A" } }]);
    expect(dv.pagePaths()).toEqual(["A.md", "B.md"]);
    expect(await dv.query("LIST")).toEqual({ successful: true });
    expect(Object.values(dv)).not.toContain(api);
  });

  it("facade returns empty/rejects when api absent", async () => {
    const a = new DataviewAdapter(
      new PluginConfigService(memHost({}), [SAUCE_DATAVIEW_PROFILE]),
      runtime({ getApi: () => null }),
    );
    const dv = a.getServiceFacade<SauceDataviewFacade>();
    expect(dv.isAvailable()).toBe(false);
    expect(dv.pages()).toEqual([]);
    await expect(dv.query("LIST")).rejects.toThrow(/unavailable/i);
  });
});
