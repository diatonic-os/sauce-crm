import { beforeEach, describe, expect, it, vi } from "vitest";
import { ModelCatalog, type CatalogContext } from "../src/copilot/ModelCatalog";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("ModelCatalog", () => {
  let calls: string[];
  let fetchImpl: ReturnType<typeof vi.fn>;
  let cat: ModelCatalog;

  beforeEach(() => {
    calls = [];
    fetchImpl = vi.fn(async (url: string) => {
      calls.push(url);
      if (url.includes("/api/tags")) {
        return jsonResponse({ models: [{ name: "llama3:8b", size: 4_500_000_000, details: { family: "llama" } }, { name: "qwen2.5:14b" }] });
      }
      if (url.includes("integrate.api.nvidia.com")) {
        return jsonResponse({ data: [{ id: "meta/llama-4-maverick-17b-128e-instruct", owned_by: "meta" }, { id: "nvidia/llama-3.1-nemotron-70b-instruct", owned_by: "nvidia" }] });
      }
      if (url.includes("/v1/models")) {
        return jsonResponse({ data: [{ id: "qwen/qwen3.6-27b" }, { id: "nvidia/nemotron-3-nano-4b" }] });
      }
      return new Response("nope", { status: 404 });
    });
    cat = new ModelCatalog(fetchImpl as unknown as typeof fetch);
  });

  it("lists ollama models from /api/tags", async () => {
    const models = await cat.list({ provider: "ollama", endpoint: "http://localhost:11434" });
    expect(models.map(m => m.id)).toEqual(["llama3:8b", "qwen2.5:14b"]);
    expect(models[0].family).toBe("llama");
    expect(models[0].sizeBytes).toBe(4_500_000_000);
  });

  it("lists lmstudio models from /v1/models", async () => {
    const models = await cat.list({ provider: "lmstudio", endpoint: "http://localhost:1234" });
    expect(models.map(m => m.id)).toEqual(["qwen/qwen3.6-27b", "nvidia/nemotron-3-nano-4b"]);
  });

  it("lists nim models from integrate.api.nvidia.com", async () => {
    const models = await cat.list({ provider: "nim" });
    expect(models.map(m => m.id)).toContain("meta/llama-4-maverick-17b-128e-instruct");
  });

  it("returns curated static lists for anthropic + openai", async () => {
    const a = await cat.list({ provider: "anthropic" });
    const o = await cat.list({ provider: "openai" });
    expect(a.some(m => m.id === "claude-opus-4-7")).toBe(true);
    expect(o.some(m => m.id === "gpt-4o")).toBe(true);
  });

  it("caches per (provider, endpoint) for 30s — second call same context does not refetch", async () => {
    const ctx: CatalogContext = { provider: "ollama", endpoint: "http://localhost:11434" };
    await cat.list(ctx);
    await cat.list(ctx);
    expect(calls.length).toBe(1);
  });

  it("different endpoint = different cache key", async () => {
    await cat.list({ provider: "ollama", endpoint: "http://a:11434" });
    await cat.list({ provider: "ollama", endpoint: "http://b:11434" });
    expect(calls.length).toBe(2);
  });

  it("invalidate() forces a refetch", async () => {
    const ctx: CatalogContext = { provider: "ollama", endpoint: "http://localhost:11434" };
    await cat.list(ctx);
    cat.invalidate(ctx);
    await cat.list(ctx);
    expect(calls.length).toBe(2);
  });

  it("on fetch error returns static fallback for openai/anthropic, [] otherwise", async () => {
    const badFetch = vi.fn(async () => { throw new Error("network"); });
    const c2 = new ModelCatalog(badFetch as unknown as typeof fetch);
    expect((await c2.list({ provider: "anthropic" })).length).toBeGreaterThan(0);
    expect(await c2.list({ provider: "ollama", endpoint: "http://x" })).toEqual([]);
  });

  it("propagates logger.event hits when a logger is wired", async () => {
    const events: Array<{ name: string; data?: unknown }> = [];
    const logger = {
      trace: () => {}, debug: () => {}, info: () => {}, warn: () => {}, error: () => {},
      event: (name: string, data?: unknown) => { events.push({ name, data }); },
      child: () => logger,
    };
    const c2 = new ModelCatalog(fetchImpl as unknown as typeof fetch, logger as never);
    await c2.list({ provider: "ollama", endpoint: "http://localhost:11434" });
    await c2.list({ provider: "ollama", endpoint: "http://localhost:11434" }); // cache hit
    expect(events.map(e => e.name)).toContain("model_catalog.fetch");
    expect(events.map(e => e.name)).toContain("model_catalog.miss");
    expect(events.map(e => e.name)).toContain("model_catalog.hit");
  });
});
