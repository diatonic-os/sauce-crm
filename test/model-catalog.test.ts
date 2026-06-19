import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ModelCatalog,
  type CatalogContext,
} from "../src/saucebot/ModelCatalog";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
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
        return jsonResponse({
          models: [
            {
              name: "llama3:8b",
              size: 4_500_000_000,
              details: { family: "llama" },
            },
            { name: "qwen2.5:14b" },
          ],
        });
      }
      if (url.includes("integrate.api.nvidia.com")) {
        return jsonResponse({
          data: [
            { id: "meta/llama-4-maverick-17b-128e-instruct", owned_by: "meta" },
            {
              id: "nvidia/llama-3.1-nemotron-70b-instruct",
              owned_by: "nvidia",
            },
          ],
        });
      }
      if (url.includes("/v1/models")) {
        return jsonResponse({
          data: [
            { id: "qwen/qwen3.6-27b" },
            { id: "nvidia/nemotron-3-nano-4b" },
          ],
        });
      }
      return new Response("nope", { status: 404 });
    });
    cat = new ModelCatalog(fetchImpl as unknown as typeof fetch);
  });

  it("lists ollama models from /api/tags", async () => {
    const models = await cat.list({
      provider: "ollama",
      endpoint: "http://localhost:11434",
    });
    expect(models.map((m) => m.id)).toEqual(["llama3:8b", "qwen2.5:14b"]);
    expect(models[0].family).toBe("llama");
    expect(models[0].sizeBytes).toBe(4_500_000_000);
  });

  it("lists lmstudio models from /v1/models", async () => {
    const models = await cat.list({
      provider: "lmstudio",
      endpoint: "http://localhost:1234",
    });
    expect(models.map((m) => m.id)).toEqual([
      "qwen/qwen3.6-27b",
      "nvidia/nemotron-3-nano-4b",
    ]);
  });

  it("lists nim models from integrate.api.nvidia.com", async () => {
    const models = await cat.list({ provider: "nim" });
    expect(models.map((m) => m.id)).toContain(
      "meta/llama-4-maverick-17b-128e-instruct",
    );
  });

  it("returns curated static lists for anthropic + openai", async () => {
    const a = await cat.list({ provider: "anthropic" });
    const o = await cat.list({ provider: "openai" });
    expect(a.some((m) => m.id === "claude-opus-4-7")).toBe(true);
    expect(o.some((m) => m.id === "gpt-4o")).toBe(true);
  });

  it("caches per (provider, endpoint) for 30s — second call same context does not refetch", async () => {
    const ctx: CatalogContext = {
      provider: "ollama",
      endpoint: "http://localhost:11434",
    };
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
    const ctx: CatalogContext = {
      provider: "ollama",
      endpoint: "http://localhost:11434",
    };
    await cat.list(ctx);
    cat.invalidate(ctx);
    await cat.list(ctx);
    expect(calls.length).toBe(2);
  });

  it("on fetch error returns static fallback for openai/anthropic, [] otherwise", async () => {
    const badFetch = vi.fn(async () => {
      throw new Error("network");
    });
    const c2 = new ModelCatalog(badFetch as unknown as typeof fetch);
    expect((await c2.list({ provider: "anthropic" })).length).toBeGreaterThan(
      0,
    );
    expect(await c2.list({ provider: "ollama", endpoint: "http://x" })).toEqual(
      [],
    );
  });

  it("propagates logger.event hits when a logger is wired", async () => {
    const events: Array<{ name: string; data?: unknown }> = [];
    const logger = {
      trace: () => {},
      debug: () => {},
      info: () => {},
      warn: () => {},
      error: () => {},
      event: (name: string, data?: unknown) => {
        events.push({ name, data });
      },
      child: () => logger,
    };
    const c2 = new ModelCatalog(
      fetchImpl as unknown as typeof fetch,
      logger as never,
    );
    await c2.list({ provider: "ollama", endpoint: "http://localhost:11434" });
    await c2.list({ provider: "ollama", endpoint: "http://localhost:11434" }); // cache hit
    expect(events.map((e) => e.name)).toContain("model_catalog.fetch");
    expect(events.map((e) => e.name)).toContain("model_catalog.miss");
    expect(events.map((e) => e.name)).toContain("model_catalog.hit");
  });
});

describe("ModelCatalog — OpenAI live wiring + endpoint normalization", () => {
  function openAiFetch() {
    const calls: string[] = [];
    const impl = vi.fn(async (url: string) => {
      calls.push(url);
      if (url.includes("api.openai.com") || url.endsWith("/v1/models")) {
        return new Response(
          JSON.stringify({
            data: [
              { id: "gpt-4o" },
              { id: "gpt-4.1-mini" },
              { id: "o3" },
              { id: "text-embedding-3-small" },
              { id: "whisper-1" },
              { id: "dall-e-3" },
              { id: "gpt-4o-realtime-preview" },
              { id: "omni-moderation-latest" },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return new Response("nope", { status: 404 });
    });
    return { impl, calls };
  }

  it("fetches live OpenAI models when an API key is present, filtered to chat models", async () => {
    const { impl } = openAiFetch();
    const cat = new ModelCatalog(impl as unknown as typeof fetch);
    const models = await cat.list({ provider: "openai", apiKey: "sk-test" });
    const ids = models.map((m) => m.id);
    expect(ids).toEqual(["gpt-4.1-mini", "gpt-4o", "o3"]); // sorted, chat-only
    expect(ids).not.toContain("text-embedding-3-small");
    expect(ids).not.toContain("whisper-1");
    expect(ids).not.toContain("dall-e-3");
    expect(ids).not.toContain("gpt-4o-realtime-preview");
    expect(ids).not.toContain("omni-moderation-latest");
  });

  it("falls back to the curated list when no API key is set", async () => {
    const { impl, calls } = openAiFetch();
    const cat = new ModelCatalog(impl as unknown as typeof fetch);
    const models = await cat.list({ provider: "openai" });
    expect(models.some((m) => m.id === "gpt-4o")).toBe(true);
    expect(calls.length).toBe(0); // no network call without a key
  });

  it("falls back to curated on an OpenAI fetch error", async () => {
    const impl = vi.fn(
      async () => new Response("unauthorized", { status: 401 }),
    );
    const cat = new ModelCatalog(impl as unknown as typeof fetch);
    const models = await cat.list({ provider: "openai", apiKey: "sk-bad" });
    expect(models.some((m) => m.id === "gpt-4o")).toBe(true);
  });

  it("does not produce double paths when the endpoint already ends in /v1", async () => {
    const { impl, calls } = openAiFetch();
    const cat = new ModelCatalog(impl as unknown as typeof fetch);
    await cat.list({
      provider: "lmstudio",
      endpoint: "http://localhost:1234/v1",
    });
    // LM Studio now prefers the native /api/v0 endpoint; the trailing /v1 from
    // the saved endpoint must be stripped (no /v1/api/v0, no /v1/v1).
    expect(calls[0]).toBe("http://localhost:1234/api/v0/models");
    expect(calls[0]).not.toContain("/v1/");
  });
});

describe("ModelCatalog — embedding-kind listing", () => {
  function fetchMock() {
    const calls: string[] = [];
    const impl = vi.fn(async (url: string) => {
      calls.push(url);
      if (url.includes("api.openai.com")) {
        return new Response(
          JSON.stringify({
            data: [
              { id: "gpt-4o" },
              { id: "text-embedding-3-small" },
              { id: "text-embedding-3-large" },
              { id: "whisper-1" },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (url.includes("localhost:1234")) {
        // lmstudio
        return new Response(
          JSON.stringify({
            data: [
              { id: "qwen/qwen3.6-27b" },
              { id: "nomic-embed-text-v1.5" },
              { id: "text-embedding-bge-m3" },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return new Response("nope", { status: 404 });
    });
    return { impl, calls };
  }

  it("lists OpenAI embedding models live (filtered to embeddings)", async () => {
    const { impl } = fetchMock();
    const cat = new ModelCatalog(impl as unknown as typeof fetch);
    const models = await cat.list({
      provider: "openai",
      apiKey: "sk-x",
      kind: "embedding",
    });
    const ids = models.map((m) => m.id);
    expect(ids).toEqual(["text-embedding-3-large", "text-embedding-3-small"]); // sorted, embeddings only
    expect(ids).not.toContain("gpt-4o");
  });

  it("falls back to curated OpenAI embeddings without a key", async () => {
    const { impl, calls } = fetchMock();
    const cat = new ModelCatalog(impl as unknown as typeof fetch);
    const models = await cat.list({ provider: "openai", kind: "embedding" });
    expect(models.some((m) => m.id === "text-embedding-3-small")).toBe(true);
    expect(calls.length).toBe(0);
  });

  it("narrows a local provider's flat list to embedding models", async () => {
    const { impl } = fetchMock();
    const cat = new ModelCatalog(impl as unknown as typeof fetch);
    const models = await cat.list({
      provider: "lmstudio",
      endpoint: "http://localhost:1234",
      kind: "embedding",
    });
    const ids = models.map((m) => m.id);
    expect(ids).toContain("nomic-embed-text-v1.5");
    expect(ids).toContain("text-embedding-bge-m3");
    expect(ids).not.toContain("qwen/qwen3.6-27b");
  });

  it("returns no embedding models for anthropic", async () => {
    const { impl } = fetchMock();
    const cat = new ModelCatalog(impl as unknown as typeof fetch);
    expect(
      await cat.list({ provider: "anthropic", kind: "embedding" }),
    ).toEqual([]);
  });

  it("caches chat and embedding lists separately", async () => {
    const { impl, calls } = fetchMock();
    const cat = new ModelCatalog(impl as unknown as typeof fetch);
    await cat.list({ provider: "openai", apiKey: "sk-x", kind: "chat" });
    await cat.list({ provider: "openai", apiKey: "sk-x", kind: "embedding" });
    expect(calls.length).toBe(2); // different cache keys ⇒ two fetches
  });
});
