import { describe, expect, it } from "vitest";
import {
  BratAdapter,
  BRAT_PLUGIN_ID,
  SAUCE_BETA_REPO,
  type BratRuntimeHost,
  type SauceBratFacade,
} from "../../../src/integrations/obsidian/BratAdapter";

function runtime(optIn: boolean): BratRuntimeHost & { list: Set<string> } {
  const list = new Set<string>();
  return {
    list,
    isInstalled: () => true,
    isEnabled: () => true,
    getVersion: () => "0.8.0",
    isBetaOptIn: () => optIn,
    hasBetaPlugin: (r) => list.has(r),
    addBetaPlugin: (r) => list.add(r),
  };
}

describe("BratAdapter", () => {
  it("is the brat community plugin and supportsBeta()", () => {
    const a = new BratAdapter(runtime(false));
    expect(a.pluginId).toBe(BRAT_PLUGIN_ID);
    expect(a.supportsBeta()).toBe(true);
  });

  it("does NOT add the beta repo when not opted in (G-008: opt-in gated, default off)", async () => {
    const rt = runtime(false);
    const a = new BratAdapter(rt);
    const res = await a.optimize();
    expect(res.applied).toHaveLength(0);
    expect(rt.list.has(SAUCE_BETA_REPO)).toBe(false);
    // nothing to do ⇒ detect reports optimized
    expect((await a.detect()).optimized).toBe(true);
  });

  it("adds the beta repo when opted in, idempotently", async () => {
    const rt = runtime(true);
    const a = new BratAdapter(rt);
    expect((await a.detect()).optimized).toBe(false);
    const res = await a.optimize();
    expect(res.applied).toHaveLength(1);
    expect(rt.list.has(SAUCE_BETA_REPO)).toBe(true);
    expect((await a.optimize()).applied).toHaveLength(0);
    expect((await a.detect()).optimized).toBe(true);
  });

  it("facade.registerBetaRepo respects the opt-in gate", () => {
    const rtOff = runtime(false);
    new BratAdapter(rtOff)
      .getServiceFacade<SauceBratFacade>()
      .registerBetaRepo();
    expect(rtOff.list.size).toBe(0);

    const rtOn = runtime(true);
    const f = new BratAdapter(rtOn).getServiceFacade<SauceBratFacade>();
    expect(f.isBetaEnabled()).toBe(true);
    f.registerBetaRepo();
    expect(rtOn.list.has(SAUCE_BETA_REPO)).toBe(true);
  });
});
