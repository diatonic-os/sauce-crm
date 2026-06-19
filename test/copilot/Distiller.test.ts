// Distillation pipeline — deterministic TOON + gated inference loop + 100% cache
// + auto-best-model. Provider-agnostic: the LLM seam is a plain function double.

import { describe, expect, it, vi } from "vitest";
import {
  Distiller,
  DistillCache,
  pickBestLocalModel,
  type DistillInput,
} from "../../src/saucebot/Distiller";

const INPUT: DistillInput = {
  query: "who do we know in ranking?",
  chunks: [
    {
      path: "people/alice.md",
      text: "Staff ML eng at Acme, ranking lead, opt_in true",
    },
    { path: "people/bob.md", text: "PM at Globex, unrelated" },
  ],
};

describe("Distiller", () => {
  it("returns deterministic TOON when LLM is disabled, preserving paths", async () => {
    const d = new Distiller(null);
    const r = await d.distill(INPUT, { useLlm: false });
    expect(r.toon).toContain("people/alice.md");
    expect(r.toon).toContain("query: ");
    expect(r.distilled).toBe(false);
    expect(r.passes).toBe(0);
    expect(r.cached).toBe(false);
  });

  it("runs an inference pass when over the token gate and accepts a smaller result", async () => {
    const fn = vi.fn(
      async () =>
        "query: ranking\nsources[1]{path,gist}:\n  people/alice.md,ranking lead",
    );
    const d = new Distiller(fn);
    const r = await d.distill(INPUT, {
      useLlm: true,
      tokenGate: 1,
      maxPasses: 2,
    });
    expect(fn).toHaveBeenCalled();
    expect(r.distilled).toBe(true);
    expect(r.passes).toBeGreaterThanOrEqual(1);
    expect(r.tokensAfter).toBeLessThan(r.tokensBefore + 50);
  });

  it("does NOT accept an LLM result that fails to shrink the context", async () => {
    const bloat = vi.fn(async () => "x".repeat(100000));
    const d = new Distiller(bloat);
    const r = await d.distill(INPUT, {
      useLlm: true,
      tokenGate: 1,
      maxPasses: 3,
    });
    expect(r.distilled).toBe(false); // rejected the bigger output
    expect(r.passes).toBe(0);
  });

  it("strips code fences the model may wrap output in", async () => {
    const fenced = vi.fn(async () => "```toon\nquery: q\nsources[0]:\n```");
    const d = new Distiller(fenced);
    const r = await d.distill(INPUT, {
      useLlm: true,
      tokenGate: 1,
      maxPasses: 1,
    });
    expect(r.toon).not.toContain("```");
    expect(r.toon).toContain("query: q");
  });

  it("caches by input+model: a second identical distill is a free cache hit", async () => {
    const fn = vi.fn(async () => "query: q\nsources[0]:");
    const d = new Distiller(fn);
    const a = await d.distill(INPUT, {
      useLlm: true,
      tokenGate: 1,
      modelTag: "m1",
    });
    const callsAfterFirst = fn.mock.calls.length;
    const b = await d.distill(INPUT, {
      useLlm: true,
      tokenGate: 1,
      modelTag: "m1",
    });
    expect(b.cached).toBe(true);
    expect(fn.mock.calls.length).toBe(callsAfterFirst); // no new model calls
    expect(b.toon).toBe(a.toon);
  });

  it("re-distills when the model tag changes (switching distill model)", async () => {
    const fn = vi.fn(async () => "query: q\nsources[0]:");
    const d = new Distiller(fn);
    await d.distill(INPUT, { useLlm: true, tokenGate: 1, modelTag: "m1" });
    const r = await d.distill(INPUT, {
      useLlm: true,
      tokenGate: 1,
      modelTag: "m2",
    });
    expect(r.cached).toBe(false);
  });
});

describe("pickBestLocalModel", () => {
  it("excludes embedding/vision models and picks the largest by param count", () => {
    const ids = [
      "text-embedding-bge-m3",
      "qwen/qwen3.5-9b",
      "qwen/qwen3.6-27b",
      "nemotron-mini-4b-instruct",
    ];
    expect(pickBestLocalModel(ids)).toBe("qwen/qwen3.6-27b");
  });

  it("returns null when only embedding models are available", () => {
    expect(
      pickBestLocalModel(["text-embedding-qwen3-embedding-8b"]),
    ).toBeNull();
  });

  it("falls back to a stable choice when no param sizes parse", () => {
    expect(pickBestLocalModel(["gpt-oss", "mistral-small"])).toBe("gpt-oss");
  });
});

describe("DistillCache", () => {
  it("round-trips through JSON", () => {
    const c = new DistillCache();
    c.set("k", "query: q");
    const restored = DistillCache.fromJSON(c.toJSON());
    expect(restored.get("k")).toBe("query: q");
    expect(restored.dirty).toBe(false);
  });
});
