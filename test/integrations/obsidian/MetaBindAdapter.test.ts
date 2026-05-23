import { describe, expect, it } from "vitest";
import {
  MetaBindAdapter,
  METABIND_PLUGIN_ID,
  SAUCE_BIND_TARGETS,
  type MetaBindRuntimeHost,
  type SauceMetaBindFacade,
} from "../../../src/integrations/obsidian/MetaBindAdapter";

function runtime(
  registered: string[],
): MetaBindRuntimeHost & { reg: string[] } {
  const reg = [...registered];
  return {
    reg,
    isInstalled: () => true,
    isEnabled: () => true,
    getVersion: () => "1.0.0",
    registeredTargets: () => reg,
    registerTargets: (t) => reg.push(...t),
  };
}

describe("MetaBindAdapter", () => {
  it("is the metabind community plugin", () => {
    const a = new MetaBindAdapter(runtime([]));
    expect(a.pluginId).toBe(METABIND_PLUGIN_ID);
  });

  it("detect() unoptimized until all sauce:* bind targets are registered", async () => {
    const a = new MetaBindAdapter(runtime([]));
    expect((await a.detect()).optimized).toBe(false);
    await a.optimize();
    expect((await a.detect()).optimized).toBe(true);
  });

  it("optimize() registers the three sauce bind targets, idempotently", async () => {
    const rt = runtime([]);
    const a = new MetaBindAdapter(rt);
    const res = await a.optimize();
    expect(res.applied.map((c) => c.to).sort()).toEqual(
      [...SAUCE_BIND_TARGETS].sort(),
    );
    expect(rt.reg).toEqual([...SAUCE_BIND_TARGETS]);
    const second = await a.optimize();
    expect(second.applied).toHaveLength(0);
  });

  it("facade lists targets and registers, no raw handle", () => {
    const a = new MetaBindAdapter(runtime([]));
    const f = a.getServiceFacade<SauceMetaBindFacade>();
    expect(f.listBindTargets()).toEqual([...SAUCE_BIND_TARGETS]);
    expect(f.isAvailable()).toBe(true);
  });
});
