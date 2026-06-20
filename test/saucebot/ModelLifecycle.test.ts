import { describe, it, expect } from "vitest";
import {
  switchModel,
  type ModelManagerLike,
} from "../../src/saucebot/ModelLifecycle";

function fakeMgr(loaded: string[]) {
  const events: string[] = [];
  const set = new Set(loaded);
  const mgr: ModelManagerLike = {
    listLoaded: async () => [...set].map((id) => ({ id })),
    load: async (id) => {
      events.push("load:" + id);
      set.add(id);
      return { id };
    },
    unload: async (id) => {
      events.push("unload:" + id);
      set.delete(id);
    },
  };
  return { mgr, events, set };
}

describe("dual-load policy", () => {
  it("never unloads a protected (embed) model when switching chat", async () => {
    const { mgr, events } = fakeMgr(["chat-old", "embed-model"]);
    const r = await switchModel(mgr, {
      provider: "lmstudio",
      prev: "embed-model", // pretend the prev happened to be the embed model
      next: "chat-new",
      protect: ["embed-model"],
    });
    expect(r.loaded).toBe("chat-new");
    expect(r.unloaded).toBeUndefined();
    expect(events).not.toContain("unload:embed-model");
  });

  it("defaultKeepWarm is on for local, off for cloud", async () => {
    const { defaultKeepWarm } = await import(
      "../../src/saucebot/ModelLifecycle"
    );
    expect(defaultKeepWarm("lmstudio")).toBe(true);
    expect(defaultKeepWarm("ollama")).toBe(true);
    expect(defaultKeepWarm("anthropic")).toBe(false);
    expect(defaultKeepWarm("openai")).toBe(false);
  });
});

describe("switchModel", () => {
  it("loads the new model and unloads the previous (LM Studio)", async () => {
    const { mgr, events } = fakeMgr(["old-model"]);
    const r = await switchModel(mgr, {
      provider: "lmstudio",
      prev: "old-model",
      next: "new-model",
    });
    expect(r).toEqual({ loaded: "new-model", unloaded: "old-model" });
    expect(events).toEqual(["load:new-model", "unload:old-model"]);
  });

  it("does not reload an already-loaded model", async () => {
    const { mgr, events } = fakeMgr(["new-model"]);
    const r = await switchModel(mgr, {
      provider: "lmstudio",
      prev: undefined,
      next: "new-model",
    });
    expect(r.loaded).toBeUndefined();
    expect(events).toEqual([]);
  });

  it("never unloads the newly-selected model", async () => {
    const { mgr } = fakeMgr(["m1"]);
    const r = await switchModel(mgr, {
      provider: "lmstudio",
      prev: "m1",
      next: "m1",
    });
    expect(r.unloaded).toBeUndefined();
  });

  it("skips unload when unloadPrev=false", async () => {
    const { mgr, events } = fakeMgr(["old"]);
    const r = await switchModel(mgr, {
      provider: "lmstudio",
      prev: "old",
      next: "new",
      unloadPrev: false,
    });
    expect(r).toEqual({ loaded: "new" });
    expect(events).toEqual(["load:new"]);
  });

  it("does not unload a prev that isn't loaded", async () => {
    const { mgr, events } = fakeMgr([]); // nothing loaded
    const r = await switchModel(mgr, {
      provider: "lmstudio",
      prev: "ghost",
      next: "new",
    });
    expect(r).toEqual({ loaded: "new" });
    expect(events).toEqual(["load:new"]);
  });

  it("is a no-op for cloud providers", async () => {
    const { mgr, events } = fakeMgr(["x"]);
    const r = await switchModel(mgr, {
      provider: "anthropic",
      prev: "a",
      next: "b",
    });
    expect(r.skipped).toMatch(/cloud/);
    expect(events).toEqual([]);
  });

  it("passes ttlSeconds through to load", async () => {
    const calls: Array<{ id: string; ttl?: number }> = [];
    const mgr: ModelManagerLike = {
      listLoaded: async () => [],
      load: async (id, opts) => {
        calls.push({ id, ttl: opts?.ttlSeconds });
        return { id };
      },
      unload: async () => {},
    };
    await switchModel(mgr, {
      provider: "lmstudio",
      next: "m",
      ttlSeconds: 600,
    });
    expect(calls).toEqual([{ id: "m", ttl: 600 }]);
  });
});
