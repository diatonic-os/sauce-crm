import { describe, expect, it } from "vitest";
import {
  deriveLearnedCeiling,
  probeHostEnvironment,
  type ProbeOpts,
  type HostEnvironment,
  type CapabilityModel,
} from "../../src/saucebot/lmstudio/HostProbe";

const m = (id: string, extra: Partial<CapabilityModel> = {}): CapabilityModel => ({
  id,
  label: id,
  ...extra,
});

describe("deriveLearnedCeiling", () => {
  it("returns max bytes among known-good models found in catalog", () => {
    const catalog: CapabilityModel[] = [
      m("lfm2-1.2b", { sizeBytes: 1e9 }),
      m("qwen3-7b", { sizeBytes: 7e9 }),
      m("qwen3-30b", { sizeBytes: 30e9 }),
    ];
    const knownGood = ["qwen3-7b", "qwen3-30b"];
    const ceiling = deriveLearnedCeiling(knownGood, catalog);
    expect(ceiling).toBe(30e9);
  });

  it("ignores unknown ids; returns 0 when none match", () => {
    const catalog: CapabilityModel[] = [m("lfm2-1.2b", { sizeBytes: 1e9 })];
    const knownGood = ["unknown-model-id", "another-unknown"];
    const ceiling = deriveLearnedCeiling(knownGood, catalog);
    expect(ceiling).toBe(0);
  });

  it("returns 0 on empty knownGoodModels", () => {
    const catalog: CapabilityModel[] = [m("lfm2-1.2b", { sizeBytes: 1e9 })];
    const ceiling = deriveLearnedCeiling([], catalog);
    expect(ceiling).toBe(0);
  });

  it("handles models without sizeBytes by estimating", () => {
    const catalog: CapabilityModel[] = [
      m("qwen3-7b-q4_k_m"), // no sizeBytes, but can be estimated
      m("unknown-model"), // truly unknown
    ];
    const knownGood = ["qwen3-7b-q4_k_m"];
    const ceiling = deriveLearnedCeiling(knownGood, catalog);
    // 7B * 0.5 B/param (q4) * 1.2 overhead = ~4.2GB
    expect(ceiling).toBeGreaterThan(3e9);
    expect(ceiling).toBeLessThan(6e9);
  });

  it("returns max when multiple known-good models in catalog", () => {
    const catalog: CapabilityModel[] = [
      m("lfm2-1.2b", { sizeBytes: 1e9 }),
      m("qwen3-7b", { sizeBytes: 7e9 }),
      m("qwen3-30b", { sizeBytes: 30e9 }),
      m("other-model", { sizeBytes: 5e9 }),
    ];
    const knownGood = ["lfm2-1.2b", "qwen3-7b"];
    const ceiling = deriveLearnedCeiling(knownGood, catalog);
    expect(ceiling).toBe(7e9);
  });
});

describe("probeHostEnvironment", () => {
  it("merges gpuInfo VRAM into the environment", async () => {
    const gpuInfo = async () => ({
      totalVramBytes: 24e9,
      freeVramBytes: 20e9,
    });
    const opts: ProbeOpts = { gpuInfo };
    const env = await probeHostEnvironment(opts);
    expect(env.totalVramBytes).toBe(24e9);
    expect(env.freeVramBytes).toBe(20e9);
  });

  it("sets learnedMaxLoadedBytes when ceiling > 0", async () => {
    const catalog: CapabilityModel[] = [
      m("qwen3-7b", { sizeBytes: 7e9 }),
    ];
    const opts: ProbeOpts = {
      knownGoodModels: ["qwen3-7b"],
      catalog,
    };
    const env = await probeHostEnvironment(opts);
    expect(env.learnedMaxLoadedBytes).toBe(7e9);
  });

  it("omits learnedMaxLoadedBytes when ceiling is 0", async () => {
    const opts: ProbeOpts = {
      knownGoodModels: [],
      catalog: [],
    };
    const env = await probeHostEnvironment(opts);
    expect(env.learnedMaxLoadedBytes).toBeUndefined();
  });

  it("tolerates throwing gpuInfo without rejecting", async () => {
    const gpuInfo = async () => {
      throw new Error("GPU detection failed");
    };
    const opts: ProbeOpts = { gpuInfo };
    const env = await probeHostEnvironment(opts);
    // Should not throw; other fields should be populated if provided
    expect(env).toBeDefined();
  });

  it("merges gpuInfo and knownGoodModels ceiling", async () => {
    const gpuInfo = async () => ({
      totalVramBytes: 24e9,
      freeVramBytes: 20e9,
    });
    const catalog: CapabilityModel[] = [
      m("qwen3-30b", { sizeBytes: 30e9 }),
    ];
    const opts: ProbeOpts = {
      gpuInfo,
      knownGoodModels: ["qwen3-30b"],
      catalog,
    };
    const env = await probeHostEnvironment(opts);
    expect(env.totalVramBytes).toBe(24e9);
    expect(env.freeVramBytes).toBe(20e9);
    expect(env.learnedMaxLoadedBytes).toBe(30e9);
  });

  it("omits undefined fields from gpuInfo", async () => {
    const gpuInfo = async () => ({
      totalVramBytes: 24e9,
      // freeVramBytes omitted
    });
    const opts: ProbeOpts = { gpuInfo };
    const env = await probeHostEnvironment(opts);
    expect(env.totalVramBytes).toBe(24e9);
    expect(env.freeVramBytes).toBeUndefined();
  });

  it("handles missing knownGoodModels gracefully", async () => {
    const gpuInfo = async () => ({
      totalVramBytes: 24e9,
    });
    const opts: ProbeOpts = { gpuInfo };
    const env = await probeHostEnvironment(opts);
    expect(env.totalVramBytes).toBe(24e9);
    expect(env.learnedMaxLoadedBytes).toBeUndefined();
  });

  it("handles missing catalog gracefully", async () => {
    const opts: ProbeOpts = {
      knownGoodModels: ["qwen3-7b"],
    };
    const env = await probeHostEnvironment(opts);
    expect(env.learnedMaxLoadedBytes).toBeUndefined();
  });
});
