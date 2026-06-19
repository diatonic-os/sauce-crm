// ModelManager tests — covers every classifyLoadFailure branch (including the
// exact live strings from llama.cpp / LM Studio), permanent vs transient,
// recordFailure blocklist behaviour, ensureLoaded's 4 outcomes, and
// fallbackChatModel preference ordering.

import { describe, expect, it, vi } from "vitest";
import {
  classifyLoadFailure,
  ModelManager,
  type BlocklistStore,
  type CatalogModel,
  type ModelManagerHost,
  type ModelLoadError,
} from "../../src/saucebot/ModelManager";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeBlocklist(initial: string[] = []): BlocklistStore {
  const list = [...initial];
  return {
    get: () => [...list],
    add: (id: string) => {
      if (!list.includes(id)) list.push(id);
    },
    remove: (id: string) => {
      const idx = list.indexOf(id);
      if (idx !== -1) list.splice(idx, 1);
    },
  };
}

function makeHost(
  models: CatalogModel[],
  opts: {
    loadModel?: (id: string) => Promise<void>;
    unloadModel?: (id: string) => Promise<void>;
  } = {},
): ModelManagerHost {
  return {
    listModels: vi.fn().mockResolvedValue(models),
    ...(opts.loadModel !== undefined ? { loadModel: opts.loadModel } : {}),
    ...(opts.unloadModel !== undefined
      ? { unloadModel: opts.unloadModel }
      : {}),
  };
}

// ---------------------------------------------------------------------------
// classifyLoadFailure — exact live strings
// ---------------------------------------------------------------------------

describe("classifyLoadFailure — arch-unsupported (permanent)", () => {
  it("classifies 'unknown model architecture: zamba2'", () => {
    const err = classifyLoadFailure(
      "zamba2",
      "unknown model architecture: 'zamba2'",
    );
    expect(err.kind).toBe("arch-unsupported");
    expect(err.permanent).toBe(true);
    expect(err.model).toBe("zamba2");
    expect(err.userMessage).toContain("zamba2");
    expect(err.userMessage).toContain("runtime build");
  });

  it("classifies GGML_ASSERT failure", () => {
    const raw = "GGML_ASSERT(ne_full % g_s == 0) failed";
    const err = classifyLoadFailure("my-model", raw);
    expect(err.kind).toBe("arch-unsupported");
    expect(err.permanent).toBe(true);
    expect(err.raw).toBe(raw);
  });

  it("classifies 'Error loading model'", () => {
    const err = classifyLoadFailure("bad-model", "Error loading model");
    expect(err.kind).toBe("arch-unsupported");
    expect(err.permanent).toBe(true);
  });

  it("classifies 'Failed to load model.'", () => {
    const err = classifyLoadFailure("bad-model", "Failed to load model.");
    expect(err.kind).toBe("arch-unsupported");
    expect(err.permanent).toBe(true);
  });
});

describe("classifyLoadFailure — oom (permanent-at-this-size)", () => {
  it("classifies 'cudaMalloc failed: out of memory'", () => {
    const err = classifyLoadFailure(
      "big-model",
      "cudaMalloc failed: out of memory",
    );
    expect(err.kind).toBe("oom");
    expect(err.permanent).toBe(true);
    expect(err.userMessage).toContain("GPU memory");
  });

  it("classifies 'alloc_tensor_range: failed to allocate'", () => {
    const err = classifyLoadFailure(
      "big-model",
      "alloc_tensor_range: failed to allocate",
    );
    expect(err.kind).toBe("oom");
    expect(err.permanent).toBe(true);
  });

  it("classifies bare 'out of memory'", () => {
    const err = classifyLoadFailure("big-model", "out of memory");
    expect(err.kind).toBe("oom");
    expect(err.permanent).toBe(true);
  });
});

describe("classifyLoadFailure — not-found (permanent)", () => {
  it("classifies HTTP 404", () => {
    const err = classifyLoadFailure("ghost-model", "HTTP 404");
    expect(err.kind).toBe("not-found");
    expect(err.permanent).toBe(true);
    expect(err.userMessage).toContain("isn't installed");
  });

  it("classifies 'model_not_found'", () => {
    const err = classifyLoadFailure("ghost-model", "model_not_found");
    expect(err.kind).toBe("not-found");
    expect(err.permanent).toBe(true);
  });

  it("classifies 'not found' (generic)", () => {
    const err = classifyLoadFailure("ghost-model", "not found");
    expect(err.kind).toBe("not-found");
    expect(err.permanent).toBe(true);
  });
});

describe("classifyLoadFailure — transient (NOT permanent)", () => {
  it("classifies 'No models loaded. Please load a model'", () => {
    const err = classifyLoadFailure(
      "any-model",
      "No models loaded. Please load a model",
    );
    expect(err.kind).toBe("transient");
    expect(err.permanent).toBe(false);
    expect(err.userMessage).toContain("retrying");
  });

  it("classifies ECONNREFUSED", () => {
    const err = classifyLoadFailure("any-model", "ECONNREFUSED");
    expect(err.kind).toBe("transient");
    expect(err.permanent).toBe(false);
  });

  it("classifies 'fetch failed'", () => {
    const err = classifyLoadFailure("any-model", "fetch failed");
    expect(err.kind).toBe("transient");
    expect(err.permanent).toBe(false);
  });

  it("classifies 'Failed to fetch'", () => {
    const err = classifyLoadFailure("any-model", "Failed to fetch");
    expect(err.kind).toBe("transient");
    expect(err.permanent).toBe(false);
  });

  it("classifies 'timeout'", () => {
    const err = classifyLoadFailure("any-model", "timeout");
    expect(err.kind).toBe("transient");
    expect(err.permanent).toBe(false);
  });

  it("classifies 'network error'", () => {
    const err = classifyLoadFailure("any-model", "network error");
    expect(err.kind).toBe("transient");
    expect(err.permanent).toBe(false);
  });
});

describe("classifyLoadFailure — unknown (NOT permanent)", () => {
  it("classifies unrecognised error string as unknown", () => {
    const err = classifyLoadFailure(
      "my-model",
      "some truly baffling error we never saw before",
    );
    expect(err.kind).toBe("unknown");
    expect(err.permanent).toBe(false);
  });

  it("classifies empty string as unknown", () => {
    const err = classifyLoadFailure("my-model", "");
    expect(err.kind).toBe("unknown");
    expect(err.permanent).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Priority: arch-unsupported wins over other patterns in the same string
// ---------------------------------------------------------------------------

describe("classifyLoadFailure — priority ordering", () => {
  it("arch-unsupported wins even if 'out of memory' also appears", () => {
    const err = classifyLoadFailure(
      "m",
      "unknown model architecture: 'foo' — out of memory",
    );
    expect(err.kind).toBe("arch-unsupported");
  });

  it("oom wins over not-found when combined", () => {
    const err = classifyLoadFailure(
      "m",
      "cudaMalloc failed: out of memory — not found",
    );
    expect(err.kind).toBe("oom");
  });
});

// ---------------------------------------------------------------------------
// recordFailure — blocklist side-effects
// ---------------------------------------------------------------------------

describe("ModelManager.recordFailure", () => {
  it("adds to blocklist for permanent failures", () => {
    const bl = makeBlocklist();
    const mgr = new ModelManager(makeHost([]), bl);
    const err = mgr.recordFailure(
      "arch-bad",
      "unknown model architecture: 'zamba2'",
    );
    expect(err.permanent).toBe(true);
    expect(bl.get()).toContain("arch-bad");
  });

  it("does NOT add to blocklist for transient failures", () => {
    const bl = makeBlocklist();
    const mgr = new ModelManager(makeHost([]), bl);
    const err = mgr.recordFailure("unreachable", "ECONNREFUSED");
    expect(err.permanent).toBe(false);
    expect(bl.get()).not.toContain("unreachable");
  });

  it("does NOT add to blocklist for unknown failures", () => {
    const bl = makeBlocklist();
    const mgr = new ModelManager(makeHost([]), bl);
    const err = mgr.recordFailure("weird", "totally unrecognised error");
    expect(err.permanent).toBe(false);
    expect(bl.get()).not.toContain("weird");
  });

  it("does not duplicate entries on repeated permanent failures", () => {
    const bl = makeBlocklist();
    const mgr = new ModelManager(makeHost([]), bl);
    mgr.recordFailure("oom-model", "cudaMalloc failed: out of memory");
    mgr.recordFailure("oom-model", "cudaMalloc failed: out of memory");
    expect(bl.get().filter((id) => id === "oom-model")).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// ensureLoaded — 4 outcomes
// ---------------------------------------------------------------------------

describe("ModelManager.ensureLoaded", () => {
  it("returns blocked when the model is on the blocklist", async () => {
    const bl = makeBlocklist(["bad-model"]);
    const host = makeHost([{ id: "bad-model", loaded: false, kind: "llm" }], {
      loadModel: vi.fn(),
    });
    const mgr = new ModelManager(host, bl);
    const result = await mgr.ensureLoaded("bad-model");
    expect(result.status).toBe("blocked");
    expect(result.error).toBeUndefined();
    // loadModel should never have been called
    expect(
      (host.loadModel as ReturnType<typeof vi.fn>).mock.calls,
    ).toHaveLength(0);
  });

  it("returns 'already' when catalog reports the model is loaded", async () => {
    const host = makeHost([{ id: "good-model", loaded: true, kind: "llm" }], {
      loadModel: vi.fn(),
    });
    const mgr = new ModelManager(host, makeBlocklist());
    const result = await mgr.ensureLoaded("good-model");
    expect(result.status).toBe("already");
    expect(result.error).toBeUndefined();
    expect(
      (host.loadModel as ReturnType<typeof vi.fn>).mock.calls,
    ).toHaveLength(0);
  });

  it("returns 'loaded' when host.loadModel succeeds", async () => {
    const loadModel = vi.fn().mockResolvedValue(undefined);
    const host = makeHost([{ id: "fresh-model", loaded: false, kind: "llm" }], {
      loadModel,
    });
    const mgr = new ModelManager(host, makeBlocklist());
    const result = await mgr.ensureLoaded("fresh-model");
    expect(result.status).toBe("loaded");
    expect(result.error).toBeUndefined();
    expect(loadModel).toHaveBeenCalledWith("fresh-model");
  });

  it("returns 'loaded' with error (and adds to blocklist) when host.loadModel fails permanently", async () => {
    const loadModel = vi
      .fn()
      .mockRejectedValue(new Error("cudaMalloc failed: out of memory"));
    const host = makeHost([{ id: "oom-model", loaded: false, kind: "llm" }], {
      loadModel,
    });
    const bl = makeBlocklist();
    const mgr = new ModelManager(host, bl);
    const result = await mgr.ensureLoaded("oom-model");
    expect(result.status).toBe("loaded");
    const error = result.error as ModelLoadError;
    expect(error.kind).toBe("oom");
    expect(error.permanent).toBe(true);
    expect(bl.get()).toContain("oom-model");
  });

  it("returns 'loaded' with error but does NOT blocklist on transient failure", async () => {
    const loadModel = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
    const host = makeHost([{ id: "maybe-model", loaded: false, kind: "llm" }], {
      loadModel,
    });
    const bl = makeBlocklist();
    const mgr = new ModelManager(host, bl);
    const result = await mgr.ensureLoaded("maybe-model");
    expect(result.status).toBe("loaded");
    const error = result.error as ModelLoadError;
    expect(error.kind).toBe("transient");
    expect(bl.get()).not.toContain("maybe-model");
  });

  it("returns 'jit' when host has no loadModel method", async () => {
    const host = makeHost([{ id: "jit-model", loaded: false, kind: "llm" }]);
    // host has no loadModel key at all
    const mgr = new ModelManager(host, makeBlocklist());
    const result = await mgr.ensureLoaded("jit-model");
    expect(result.status).toBe("jit");
    expect(result.error).toBeUndefined();
  });

  it("returns 'jit' for model not in catalog when host has no loadModel", async () => {
    const host = makeHost([]);
    const mgr = new ModelManager(host, makeBlocklist());
    const result = await mgr.ensureLoaded("unknown-model");
    expect(result.status).toBe("jit");
  });
});

// ---------------------------------------------------------------------------
// fallbackChatModel — preference ordering
// ---------------------------------------------------------------------------

describe("ModelManager.fallbackChatModel", () => {
  const MODELS: CatalogModel[] = [
    { id: "embed-model", loaded: false, kind: "embeddings", sizeBytes: 100 },
    {
      id: "small-llm",
      loaded: false,
      kind: "llm",
      sizeBytes: 500,
      contextLength: 4096,
    },
    {
      id: "medium-llm",
      loaded: false,
      kind: "llm",
      sizeBytes: 2000,
      contextLength: 8192,
    },
    {
      id: "loaded-vlm",
      loaded: true,
      kind: "vlm",
      sizeBytes: 3000,
      contextLength: 16384,
    },
    {
      id: "loaded-llm",
      loaded: true,
      kind: "llm",
      sizeBytes: 4000,
      contextLength: 32768,
    },
  ];

  it("returns the preferred model when present and not blocked", async () => {
    const mgr = new ModelManager(makeHost(MODELS), makeBlocklist());
    expect(await mgr.fallbackChatModel("medium-llm")).toBe("medium-llm");
  });

  it("skips prefer when the preferred model is not in the catalog", async () => {
    const mgr = new ModelManager(makeHost(MODELS), makeBlocklist());
    // Should fall through to a loaded model
    const result = await mgr.fallbackChatModel("does-not-exist");
    expect(["loaded-vlm", "loaded-llm"]).toContain(result);
  });

  it("skips prefer when the preferred model is blocked", async () => {
    const bl = makeBlocklist(["medium-llm"]);
    const mgr = new ModelManager(makeHost(MODELS), bl);
    const result = await mgr.fallbackChatModel("medium-llm");
    // Falls through to a loaded non-blocked model
    expect(["loaded-vlm", "loaded-llm"]).toContain(result);
  });

  it("returns a currently-loaded model when no prefer given", async () => {
    const mgr = new ModelManager(makeHost(MODELS), makeBlocklist());
    const result = await mgr.fallbackChatModel();
    expect(["loaded-vlm", "loaded-llm"]).toContain(result);
  });

  it("returns smallest model by sizeBytes when none loaded and no prefer", async () => {
    const models: CatalogModel[] = [
      { id: "big", loaded: false, kind: "llm", sizeBytes: 9000 },
      { id: "medium", loaded: false, kind: "llm", sizeBytes: 5000 },
      { id: "small", loaded: false, kind: "llm", sizeBytes: 1000 },
    ];
    const mgr = new ModelManager(makeHost(models), makeBlocklist());
    expect(await mgr.fallbackChatModel()).toBe("small");
  });

  it("breaks sizeBytes ties by contextLength (smaller wins)", async () => {
    const models: CatalogModel[] = [
      {
        id: "a",
        loaded: false,
        kind: "llm",
        sizeBytes: 1000,
        contextLength: 8192,
      },
      {
        id: "b",
        loaded: false,
        kind: "llm",
        sizeBytes: 1000,
        contextLength: 4096,
      },
      {
        id: "c",
        loaded: false,
        kind: "llm",
        sizeBytes: 1000,
        contextLength: 32768,
      },
    ];
    const mgr = new ModelManager(makeHost(models), makeBlocklist());
    expect(await mgr.fallbackChatModel()).toBe("b");
  });

  it("skips blocked models entirely when picking fallback", async () => {
    const models: CatalogModel[] = [
      { id: "blocked-small", loaded: false, kind: "llm", sizeBytes: 100 },
      { id: "ok-larger", loaded: false, kind: "llm", sizeBytes: 500 },
    ];
    const bl = makeBlocklist(["blocked-small"]);
    const mgr = new ModelManager(makeHost(models), bl);
    expect(await mgr.fallbackChatModel()).toBe("ok-larger");
  });

  it("skips embeddings models — only llm and vlm are eligible", async () => {
    const models: CatalogModel[] = [
      { id: "embed", loaded: true, kind: "embeddings", sizeBytes: 50 },
      { id: "chat-ok", loaded: false, kind: "llm", sizeBytes: 800 },
    ];
    const mgr = new ModelManager(makeHost(models), makeBlocklist());
    expect(await mgr.fallbackChatModel()).toBe("chat-ok");
  });

  it("returns null when all models are blocked", async () => {
    const models: CatalogModel[] = [
      { id: "a", loaded: false, kind: "llm" },
      { id: "b", loaded: true, kind: "vlm" },
    ];
    const bl = makeBlocklist(["a", "b"]);
    const mgr = new ModelManager(makeHost(models), bl);
    expect(await mgr.fallbackChatModel()).toBeNull();
  });

  it("returns null when catalog is empty", async () => {
    const mgr = new ModelManager(makeHost([]), makeBlocklist());
    expect(await mgr.fallbackChatModel()).toBeNull();
  });

  it("models without sizeBytes sort after those with sizeBytes", async () => {
    const models: CatalogModel[] = [
      { id: "no-size", loaded: false, kind: "llm" },
      { id: "has-size", loaded: false, kind: "llm", sizeBytes: 500 },
    ];
    const mgr = new ModelManager(makeHost(models), makeBlocklist());
    expect(await mgr.fallbackChatModel()).toBe("has-size");
  });

  it("prefer takes priority over a loaded model", async () => {
    const models: CatalogModel[] = [
      { id: "unloaded-preferred", loaded: false, kind: "llm", sizeBytes: 9000 },
      { id: "loaded-other", loaded: true, kind: "llm", sizeBytes: 100 },
    ];
    const mgr = new ModelManager(makeHost(models), makeBlocklist());
    expect(await mgr.fallbackChatModel("unloaded-preferred")).toBe(
      "unloaded-preferred",
    );
  });
});

// ---------------------------------------------------------------------------
// isBlocked — basic contract
// ---------------------------------------------------------------------------

describe("ModelManager.isBlocked", () => {
  it("returns false for models not in the blocklist", () => {
    const mgr = new ModelManager(makeHost([]), makeBlocklist());
    expect(mgr.isBlocked("clean-model")).toBe(false);
  });

  it("returns true for models in the blocklist", () => {
    const mgr = new ModelManager(makeHost([]), makeBlocklist(["bad-model"]));
    expect(mgr.isBlocked("bad-model")).toBe(true);
  });
});

describe("ModelManager — known-good fallback", () => {
  const catalog: CatalogModel[] = [
    { id: "tiny-untested", loaded: false, kind: "llm", sizeBytes: 1_000 },
    { id: "big-good", loaded: false, kind: "llm", sizeBytes: 9_000 },
    { id: "loaded-good", loaded: true, kind: "llm", sizeBytes: 5_000 },
  ];

  it("recordSuccess adds to known-good and clears a stale blocklist entry", () => {
    const block = makeBlocklist(["m1"]);
    const good = makeBlocklist();
    const mgr = new ModelManager(makeHost([]), block, good);
    mgr.recordSuccess("m1");
    expect(mgr.isKnownGood("m1")).toBe(true);
    expect(mgr.isBlocked("m1")).toBe(false); // a model that now works is unblocked
  });

  it("fallback prefers a known-good model over the smallest untested one", async () => {
    const good = makeBlocklist(["big-good"]);
    const mgr = new ModelManager(makeHost(catalog), makeBlocklist(), good);
    // Without known-good, the smallest (tiny-untested) would win; here big-good
    // is known-good so it's chosen instead of the untested tiny model.
    expect(await mgr.fallbackChatModel()).toBe("big-good");
  });

  it("fallback prefers a known-good AND loaded model first", async () => {
    const good = makeBlocklist(["big-good", "loaded-good"]);
    const mgr = new ModelManager(makeHost(catalog), makeBlocklist(), good);
    expect(await mgr.fallbackChatModel()).toBe("loaded-good");
  });

  it("with no known-good store, ordering is unchanged (loaded wins over smallest)", async () => {
    const mgr = new ModelManager(makeHost(catalog), makeBlocklist());
    expect(await mgr.fallbackChatModel()).toBe("loaded-good");
  });
});
