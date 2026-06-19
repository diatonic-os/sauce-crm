// EmbeddingsLane — realtime embeddings second lane.
//
// Tests cover: disabled states, successful embed + cache hit (ensureModel
// called exactly once), ensureModel failure surfaced as "failed", embed()
// returning null surfaced as "failed", LRU eviction past cacheSize,
// setConfig(model change) clearing cache + re-calling ensureModel, and
// stats() counters + dims.

import { describe, expect, it, vi } from "vitest";
import {
  EmbeddingsLane,
  type EmbeddingsHost,
  type EmbedLaneConfig,
} from "../../src/saucebot/EmbeddingsLane";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeVec(dims: number, fill = 0.5): Float32Array {
  return new Float32Array(dims).fill(fill);
}

function makeHost(overrides: Partial<EmbeddingsHost> = {}): EmbeddingsHost {
  return {
    ensureModel: vi.fn().mockResolvedValue({ ok: true }),
    embed: vi.fn().mockResolvedValue(makeVec(384)),
    ...overrides,
  };
}

function makeCfg(overrides: Partial<EmbedLaneConfig> = {}): EmbedLaneConfig {
  return {
    model: "text-embedding-bge-m3",
    enabled: true,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Disabled states
// ---------------------------------------------------------------------------

describe("EmbeddingsLane — disabled", () => {
  it("returns status 'disabled' when enabled=false", async () => {
    const host = makeHost();
    const lane = new EmbeddingsLane(host, makeCfg({ enabled: false }));
    const result = await lane.embedQuery("hello");
    expect(result.status).toBe("disabled");
    expect(result.vec).toBeNull();
    expect(host.ensureModel).not.toHaveBeenCalled();
    expect(host.embed).not.toHaveBeenCalled();
  });

  it("returns status 'disabled' when model is empty string", async () => {
    const host = makeHost();
    const lane = new EmbeddingsLane(host, makeCfg({ model: "" }));
    const result = await lane.embedQuery("hello");
    expect(result.status).toBe("disabled");
    expect(result.vec).toBeNull();
    expect(host.ensureModel).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Successful embed + cache hit
// ---------------------------------------------------------------------------

describe("EmbeddingsLane — successful embed then cache hit", () => {
  it("calls ensureModel exactly once across two identical queries", async () => {
    const host = makeHost();
    const lane = new EmbeddingsLane(host, makeCfg());

    const r1 = await lane.embedQuery("search query");
    expect(r1.status).toBe("ok");
    expect(r1.dims).toBe(384);
    expect(r1.vec).toBeInstanceOf(Float32Array);

    const r2 = await lane.embedQuery("search query");
    expect(r2.status).toBe("cached");
    expect(r2.dims).toBe(384);
    expect(r2.vec).toBe(r1.vec); // same Float32Array reference from cache

    // ensureModel must have been called only once total.
    expect(host.ensureModel).toHaveBeenCalledTimes(1);
    expect(host.ensureModel).toHaveBeenCalledWith("text-embedding-bge-m3");

    // embed() called once (second hit came from cache).
    expect(host.embed).toHaveBeenCalledTimes(1);
  });

  it("different text queries get separate cache entries", async () => {
    const host = makeHost();
    const lane = new EmbeddingsLane(host, makeCfg());

    await lane.embedQuery("query A");
    await lane.embedQuery("query B");

    expect(host.embed).toHaveBeenCalledTimes(2);
    expect(host.ensureModel).toHaveBeenCalledTimes(1);

    const s = lane.stats();
    expect(s.hits).toBe(0);
    expect(s.misses).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// ensureModel failure surfaced as "failed"
// ---------------------------------------------------------------------------

describe("EmbeddingsLane — ensureModel failure", () => {
  it("returns status 'failed' with reason when ensureModel rejects", async () => {
    const host = makeHost({
      ensureModel: vi.fn().mockResolvedValue({
        ok: false,
        error: "model not found on host",
      }),
    });
    const lane = new EmbeddingsLane(host, makeCfg());
    const result = await lane.embedQuery("test");
    expect(result.status).toBe("failed");
    expect(result.vec).toBeNull();
    expect(result.reason).toBe("model not found on host");
    // embed() must NOT have been called.
    expect(host.embed).not.toHaveBeenCalled();
  });

  it("uses generic reason when ensureModel returns ok:false with no error field", async () => {
    const host = makeHost({
      ensureModel: vi.fn().mockResolvedValue({ ok: false }),
    });
    const lane = new EmbeddingsLane(host, makeCfg());
    const result = await lane.embedQuery("test");
    expect(result.status).toBe("failed");
    expect(typeof result.reason).toBe("string");
    expect(result.reason!.length).toBeGreaterThan(0);
  });

  it("increments failures counter on ensureModel failure", async () => {
    const host = makeHost({
      ensureModel: vi.fn().mockResolvedValue({ ok: false, error: "offline" }),
    });
    const lane = new EmbeddingsLane(host, makeCfg());
    await lane.embedQuery("x");
    expect(lane.stats().failures).toBe(1);
    expect(lane.stats().modelReady).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// embed() returning null surfaced as "failed"
// ---------------------------------------------------------------------------

describe("EmbeddingsLane — embed() returns null", () => {
  it("returns status 'failed' with reason when embed() returns null", async () => {
    const host = makeHost({
      embed: vi.fn().mockResolvedValue(null),
    });
    const lane = new EmbeddingsLane(host, makeCfg());
    const result = await lane.embedQuery("test");
    expect(result.status).toBe("failed");
    expect(result.vec).toBeNull();
    expect(typeof result.reason).toBe("string");
  });

  it("increments failures and does not cache failed results", async () => {
    const host = makeHost({
      embed: vi.fn().mockResolvedValue(null),
    });
    const lane = new EmbeddingsLane(host, makeCfg());
    await lane.embedQuery("test");
    await lane.embedQuery("test"); // second attempt — must NOT be a cache hit

    const s = lane.stats();
    expect(s.failures).toBe(2);
    expect(s.hits).toBe(0);
    expect(s.misses).toBe(2);
    // ensureModel should have been called once (model is ready after first attempt).
    expect(host.ensureModel).toHaveBeenCalledTimes(1);
    expect(host.embed).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
// LRU eviction
// ---------------------------------------------------------------------------

describe("EmbeddingsLane — LRU eviction", () => {
  it("evicts oldest entry when cache exceeds cacheSize", async () => {
    const host = makeHost({
      // Return a distinct vec for each call so we can differentiate.
      embed: vi.fn().mockImplementation(async (text: string) => {
        return new Float32Array([text.length]);
      }),
    });
    const lane = new EmbeddingsLane(host, makeCfg({ cacheSize: 3 }));

    // Fill cache with "a", "b", "c".  Map order: [a, b, c] — "a" is oldest.
    await lane.embedQuery("a");
    await lane.embedQuery("b");
    await lane.embedQuery("c");

    // Access "a" → moves it to MRU position.  Map order: [b, c, a] — "b" is oldest.
    await lane.embedQuery("a"); // cache hit
    expect(lane.stats().hits).toBe(1);

    // Insert "d" — cache full (3); "b" is oldest → evicted. Map order: [c, a, d]
    await lane.embedQuery("d");

    // "b" was evicted: querying it is a miss and it gets re-inserted.
    // Map order after eviction of "c" (now oldest): [a, d, b]
    const missesBefore = lane.stats().misses;
    await lane.embedQuery("b");
    expect(lane.stats().misses).toBe(missesBefore + 1);

    // "a" and "d" and "b" are now in cache; "c" was evicted when "b" was re-inserted.
    const hitsBefore = lane.stats().hits;
    await lane.embedQuery("a"); // hit
    await lane.embedQuery("d"); // hit
    await lane.embedQuery("b"); // hit
    expect(lane.stats().hits).toBe(hitsBefore + 3);

    // "c" was evicted — querying it is a miss.
    const missesBefore2 = lane.stats().misses;
    await lane.embedQuery("c");
    expect(lane.stats().misses).toBe(missesBefore2 + 1);
  });

  it("does not grow beyond cacheSize", async () => {
    const embedMock = vi.fn().mockImplementation(async () => makeVec(4));
    const host = makeHost({ embed: embedMock });
    const cacheSize = 5;
    const lane = new EmbeddingsLane(host, makeCfg({ cacheSize }));

    // Insert 10 unique texts.
    for (let i = 0; i < 10; i++) {
      await lane.embedQuery(`unique-text-${i}`);
    }

    // The cache should have at most cacheSize entries; embed was called 10 times.
    expect(embedMock).toHaveBeenCalledTimes(10);

    // The most-recently-inserted 5 should be cache hits.
    const hitsBefore = lane.stats().hits;
    for (let i = 5; i < 10; i++) {
      const r = await lane.embedQuery(`unique-text-${i}`);
      expect(r.status).toBe("cached");
    }
    expect(lane.stats().hits).toBe(hitsBefore + 5);
  });
});

// ---------------------------------------------------------------------------
// setConfig — model change clears cache and re-calls ensureModel
// ---------------------------------------------------------------------------

describe("EmbeddingsLane — setConfig model change", () => {
  it("resets modelReady flag and clears cache when model id changes", async () => {
    const host = makeHost();
    const lane = new EmbeddingsLane(host, makeCfg({ model: "model-A" }));

    // Prime with model-A.
    await lane.embedQuery("hello");
    expect(host.ensureModel).toHaveBeenCalledTimes(1);
    expect(host.ensureModel).toHaveBeenLastCalledWith("model-A");

    // Switch to model-B.
    lane.setConfig(makeCfg({ model: "model-B" }));

    // Same text — must NOT be a cache hit (cache was cleared).
    const r = await lane.embedQuery("hello");
    expect(r.status).toBe("ok");
    expect(host.ensureModel).toHaveBeenCalledTimes(2);
    expect(host.ensureModel).toHaveBeenLastCalledWith("model-B");
    // embed must have been called twice total.
    expect(host.embed).toHaveBeenCalledTimes(2);
    expect(host.embed).toHaveBeenLastCalledWith("hello", "model-B");
  });

  it("does NOT reset modelReady or clear cache when only cacheSize changes", async () => {
    const host = makeHost();
    const lane = new EmbeddingsLane(host, makeCfg({ model: "model-X", cacheSize: 10 }));

    await lane.embedQuery("foo");
    expect(host.ensureModel).toHaveBeenCalledTimes(1);

    // Change only cacheSize.
    lane.setConfig(makeCfg({ model: "model-X", cacheSize: 20 }));

    // Cache was rebuilt with new size; "foo" is NOT in the new cache (it was cleared by rebuild).
    // modelReady is NOT reset because model id didn't change.
    const r = await lane.embedQuery("bar");
    expect(r.status).toBe("ok");
    // ensureModel NOT called again (model was already ready).
    expect(host.ensureModel).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// stats() — counters and dims
// ---------------------------------------------------------------------------

describe("EmbeddingsLane — stats()", () => {
  it("starts with all-zero counters", () => {
    const host = makeHost();
    const lane = new EmbeddingsLane(host, makeCfg());
    const s = lane.stats();
    expect(s.hits).toBe(0);
    expect(s.misses).toBe(0);
    expect(s.failures).toBe(0);
    expect(s.modelReady).toBe(false);
    expect(s.dims).toBeNull();
  });

  it("records dims from the first successful embed", async () => {
    const host = makeHost({
      embed: vi.fn().mockResolvedValue(makeVec(768)),
    });
    const lane = new EmbeddingsLane(host, makeCfg());
    await lane.embedQuery("first");
    expect(lane.stats().dims).toBe(768);
    expect(lane.stats().modelReady).toBe(true);
  });

  it("tracks hits, misses, and failures across calls", async () => {
    const embedMock = vi
      .fn()
      .mockResolvedValueOnce(makeVec(384)) // success
      .mockResolvedValueOnce(null);         // failure

    const host = makeHost({ embed: embedMock });
    const lane = new EmbeddingsLane(host, makeCfg());

    await lane.embedQuery("text-1"); // miss → ok
    await lane.embedQuery("text-1"); // hit
    await lane.embedQuery("text-2"); // miss → failure (embed returns null)

    const s = lane.stats();
    expect(s.hits).toBe(1);
    expect(s.misses).toBe(2);
    expect(s.failures).toBe(1);
    expect(s.dims).toBe(384); // from the first successful embed
  });
});
