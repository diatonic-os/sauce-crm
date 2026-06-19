// ModelCatalog — the live per-provider model list backing every picker.
// Pins the kind-narrowing for local providers (LM Studio /v1/models returns a
// flat list mixing chat + embedding models): the chat picker must NOT offer
// embedding models (they 400 on /chat/completions), and the embedding picker
// must offer only embedding models.

import { describe, expect, it } from "vitest";
import {
  ModelCatalog,
  formatModelLabel,
  contextShort,
} from "../../src/saucebot/ModelCatalog";

describe("formatModelLabel", () => {
  it("shows a ● when loaded, plus context + quant", () => {
    expect(
      formatModelLabel({
        id: "qwen/q9b",
        label: "qwen/q9b",
        loaded: true,
        contextTokens: 32768,
        quantization: "Q4_K_M",
        kind: "llm",
      }),
    ).toBe("● qwen/q9b  ·  33k · Q4_K_M");
  });
  it("falls back to the bare id when no metadata", () => {
    expect(formatModelLabel({ id: "gpt-4o", label: "gpt-4o" })).toBe("gpt-4o");
  });
  it("contextShort abbreviates thousands", () => {
    expect(contextShort(32768)).toBe("33k");
    expect(contextShort(512)).toBe("512");
  });
});

// Legacy stub: only /v1/models responds (no native /api/v0) — older LM Studio.
function stubFetch(ids: string[]) {
  return async (url: string) => {
    if (url.includes("/api/v0/models"))
      return { ok: false, status: 404 } as unknown as Response;
    return {
      ok: true,
      status: 200,
      json: async () => ({ data: ids.map((id) => ({ id, object: "model" })) }),
    } as unknown as Response;
  };
}

// Native stub: /api/v0/models returns rich model cards (real LM Studio 0.3.x).
function nativeStub(models: Array<Record<string, unknown>>) {
  return async (url: string) => {
    if (url.includes("/api/v0/models")) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ data: models }),
      } as unknown as Response;
    }
    return { ok: false, status: 404 } as unknown as Response;
  };
}

const LM_MODELS = [
  "text-embedding-qwen3-embedding-8b",
  "text-embedding-mxbai-embed-large-v1",
  "text-embedding-bge-m3",
  "qwen/qwen3.5-9b",
  "openai/gpt-oss-20b",
];

describe("ModelCatalog — LM Studio chat/embedding kind narrowing", () => {
  it("excludes embedding models from the chat picker", async () => {
    const cat = new ModelCatalog(stubFetch(LM_MODELS));
    const models = await cat.list({
      provider: "lmstudio",
      endpoint: "http://localhost:1234",
      kind: "chat",
    });
    const ids = models.map((m) => m.id);
    expect(ids).toContain("qwen/qwen3.5-9b");
    expect(ids).toContain("openai/gpt-oss-20b");
    expect(ids.some((id) => id.includes("embedding"))).toBe(false);
  });

  it("returns only embedding models for the embedding picker", async () => {
    const cat = new ModelCatalog(stubFetch(LM_MODELS));
    const models = await cat.list({
      provider: "lmstudio",
      endpoint: "http://localhost:1234",
      kind: "embedding",
    });
    const ids = models.map((m) => m.id);
    expect(ids.every((id) => /embed|bge|mxbai/i.test(id))).toBe(true);
    expect(ids).not.toContain("qwen/qwen3.5-9b");
  });

  it("uses native /api/v0 model cards: kind, context, quant, loaded, publisher", async () => {
    const cat = new ModelCatalog(
      nativeStub([
        {
          id: "qwen/qwen3.5-9b",
          type: "llm",
          arch: "qwen3",
          state: "loaded",
          max_context_length: 32768,
          quantization: "Q4_K_M",
          publisher: "Qwen",
        },
        {
          id: "text-embedding-bge-m3",
          type: "embeddings",
          arch: "bert",
          state: "not-loaded",
          max_context_length: 8192,
          publisher: "lm-kit",
        },
      ]),
    );
    const chat = await cat.list({
      provider: "lmstudio",
      endpoint: "http://localhost:1234",
      kind: "chat",
    });
    expect(chat.map((m) => m.id)).toEqual(["qwen/qwen3.5-9b"]); // embeddings excluded by TYPE
    const m = chat[0];
    expect(m.kind).toBe("llm");
    expect(m.contextTokens).toBe(32768);
    expect(m.quantization).toBe("Q4_K_M");
    expect(m.loaded).toBe(true);
    expect(m.publisher).toBe("Qwen");
  });

  it("classifies embeddings by TYPE even when the name doesn't match the regex", async () => {
    const cat = new ModelCatalog(
      nativeStub([
        { id: "some-weird-name-v2", type: "embeddings", state: "not-loaded" },
        { id: "chat-model-x", type: "llm", state: "loaded" },
      ]),
    );
    const emb = await cat.list({
      provider: "lmstudio",
      endpoint: "http://x",
      kind: "embedding",
    });
    expect(emb.map((m) => m.id)).toEqual(["some-weird-name-v2"]);
    const chat = await cat.list({
      provider: "lmstudio",
      endpoint: "http://x",
      kind: "chat",
    });
    expect(chat.map((m) => m.id)).toEqual(["chat-model-x"]);
  });

  it("falls back to /v1/models when the native API is unavailable", async () => {
    const cat = new ModelCatalog(
      stubFetch(["qwen/qwen3.5-9b", "text-embedding-bge-m3"]),
    );
    const chat = await cat.list({
      provider: "lmstudio",
      endpoint: "http://x",
      kind: "chat",
    });
    expect(chat.map((m) => m.id)).toContain("qwen/qwen3.5-9b");
    expect(chat.some((m) => m.id.includes("embedding"))).toBe(false);
  });

  it("keeps the full list rather than emptying it when all models look like embeddings", async () => {
    const cat = new ModelCatalog(stubFetch(["text-embedding-bge-m3"]));
    const models = await cat.list({
      provider: "lmstudio",
      endpoint: "http://localhost:1234",
      kind: "chat",
    });
    // Defensive: a noisy single-entry list beats an empty picker.
    expect(models.map((m) => m.id)).toEqual(["text-embedding-bge-m3"]);
  });
});
