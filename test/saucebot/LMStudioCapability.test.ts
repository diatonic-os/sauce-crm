import { describe, expect, it } from "vitest";
import {
  estimateModelBytes,
  fitsHost,
  gateModels,
  terse,
  TERSE,
  HARNESS_MATRIX,
  LM_STUDIO_API_SURFACE,
  type HostEnvironment,
  type CapabilityModel,
} from "../../src/saucebot/lmstudio/LMStudioCapability";

const m = (id: string, extra: Partial<CapabilityModel> = {}): CapabilityModel => ({
  id,
  label: id,
  ...extra,
});

describe("estimateModelBytes", () => {
  it("prefers a real sizeBytes when present", () => {
    expect(estimateModelBytes(m("whatever", { sizeBytes: 1234 }))).toBe(1234);
  });

  it("derives ~18GB for a 30B Q4 model from its id", () => {
    const bytes = estimateModelBytes(m("qwen3-coder-30b-q4_k_m"));
    // 30e9 params * ~0.5 B/param * overhead ⇒ ~15-21 GB band.
    expect(bytes).toBeGreaterThan(14e9);
    expect(bytes).toBeLessThan(22e9);
  });

  it("derives a much smaller footprint for a 1.2B model", () => {
    const small = estimateModelBytes(m("lfm2-1.2b"));
    const big = estimateModelBytes(m("qwen3-30b"));
    expect(small).toBeLessThan(big);
    expect(small).toBeLessThan(3e9);
  });

  it("counts f16 as heavier per-param than q4", () => {
    expect(estimateModelBytes(m("model-7b-f16"))).toBeGreaterThan(
      estimateModelBytes(m("model-7b-q4_k_m")),
    );
  });
});

describe("fitsHost", () => {
  const host = (vramGb: number, extra: Partial<HostEnvironment> = {}): HostEnvironment => ({
    totalVramBytes: vramGb * 1e9,
    ...extra,
  });

  it("fits when the estimate is comfortably under VRAM", () => {
    const v = fitsHost(m("model-7b-q4", { sizeBytes: 4e9 }), host(12));
    expect(v.fits).toBe(true);
  });

  it("does not fit when the estimate exceeds VRAM", () => {
    const v = fitsHost(m("model-70b-q4", { sizeBytes: 40e9 }), host(8));
    expect(v.fits).toBe(false);
    expect(v.reason).toBeTruthy();
  });

  it("trusts a learned ceiling from prior successful loads", () => {
    // No VRAM known, but we've loaded up to 20GB before ⇒ a 16GB model fits.
    const v = fitsHost(
      m("model", { sizeBytes: 16e9 }),
      { learnedMaxLoadedBytes: 20e9 },
    );
    expect(v.fits).toBe(true);
  });

  it("is uncertain (fits=true, low confidence) when nothing is known", () => {
    const v = fitsHost(m("mystery-model"), {});
    expect(v.fits).toBe(true);
    expect(v.confidence).toBe("low");
  });

  it("an already-loaded model always fits regardless of estimate", () => {
    const v = fitsHost(m("huge", { sizeBytes: 99e9, loaded: true }), host(8));
    expect(v.fits).toBe(true);
  });
});

describe("gateModels", () => {
  it("splits a catalog into loadable vs hidden by host fit", () => {
    const host: HostEnvironment = { totalVramBytes: 12e9 };
    const models = [
      m("small-3b", { sizeBytes: 3e9 }),
      m("medium-7b", { sizeBytes: 6e9 }),
      m("giant-70b", { sizeBytes: 45e9 }),
    ];
    const { loadable, hidden } = gateModels(models, host);
    expect(loadable.map((x) => x.id)).toContain("small-3b");
    expect(hidden.map((x) => x.id)).toContain("giant-70b");
  });

  it("never hides models when the host is fully unknown (no false negatives)", () => {
    const models = [m("a", { sizeBytes: 99e9 }), m("b", { sizeBytes: 1e9 })];
    const { loadable, hidden } = gateModels(models, {});
    expect(hidden.length).toBe(0);
    expect(loadable.length).toBe(2);
  });
});

describe("terse copy", () => {
  it("every canned status string is <= 10 words", () => {
    for (const [key, value] of Object.entries(TERSE)) {
      const words = value.trim().split(/\s+/).length;
      expect(words, `${key}="${value}"`).toBeLessThanOrEqual(10);
    }
  });

  it("terse() falls back to the key-derived default for unknown keys", () => {
    expect(terse("loaded")).toBe(TERSE.loaded);
    expect(typeof terse("nonexistent" as never)).toBe("string");
  });
});

describe("source-of-truth artifacts", () => {
  it("the API surface covers native v0, OpenAI-compat v1, and the SDK", () => {
    const groups = new Set(LM_STUDIO_API_SURFACE.map((e) => e.group));
    expect(groups.has("native-v0")).toBe(true);
    expect(groups.has("openai-v1")).toBe(true);
    expect(groups.has("sdk")).toBe(true);
  });

  it("the 3-6-9 harness matrix has 3 domains and 9 canonical ops", () => {
    const domains = new Set(HARNESS_MATRIX.map((op) => op.domain));
    expect(domains.size).toBe(3);
    expect(HARNESS_MATRIX.length).toBe(9);
  });
});
