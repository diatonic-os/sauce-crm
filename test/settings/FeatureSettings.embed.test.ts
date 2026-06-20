import { describe, it, expect } from "vitest";
import {
  DEFAULT_FEATURE_SETTINGS,
  embedDimForModel,
  resolveEmbeddingProvider,
  type SauceFeatureSettings,
} from "../../src/settings/FeatureSettings";

function settings(): SauceFeatureSettings {
  return JSON.parse(JSON.stringify(DEFAULT_FEATURE_SETTINGS));
}

describe("embedDimForModel()", () => {
  it("maps known OpenAI + local models to their dims", () => {
    expect(embedDimForModel("text-embedding-3-small")).toBe(1536);
    expect(embedDimForModel("text-embedding-3-large")).toBe(3072);
    expect(embedDimForModel("text-embedding-nomic-embed-text-v1.5")).toBe(768);
    expect(embedDimForModel("mxbai-embed-large")).toBe(1024);
  });
  it("tolerates decorated model ids", () => {
    expect(embedDimForModel("nomic-embed-text:latest")).toBe(768);
    expect(embedDimForModel("text-embedding-3-small@8bit")).toBe(1536);
    expect(embedDimForModel("TEXT-EMBEDDING-3-LARGE")).toBe(3072);
  });
  it("returns null for unknown / empty models", () => {
    expect(embedDimForModel("some-unknown-model")).toBeNull();
    expect(embedDimForModel("")).toBeNull();
  });
});

describe("resolveEmbeddingProvider()", () => {
  it("uses OpenAI (the default) when an API key is present", () => {
    const r = resolveEmbeddingProvider(settings(), true);
    expect(r?.provider).toBe("openai");
    expect(r?.reason).toBe("preferred");
    expect(embedDimForModel(r!.config.model)).toBe(1536);
  });

  it("falls back to the local LM Studio model when no OpenAI key (keyless install)", () => {
    const r = resolveEmbeddingProvider(settings(), false);
    expect(r?.provider).toBe("lmstudio");
    expect(r?.reason).toBe("fallback-no-openai-key");
    expect(embedDimForModel(r!.config.model)).toBe(768);
  });

  it("returns null when RAG is disabled", () => {
    const f = settings();
    f.rag.enabled = false;
    expect(resolveEmbeddingProvider(f, true)).toBeNull();
  });

  it("honors a local preferred provider directly", () => {
    const f = settings();
    f.rag.provider = "lmstudio";
    const r = resolveEmbeddingProvider(f, false);
    expect(r?.provider).toBe("lmstudio");
    expect(r?.reason).toBe("preferred");
  });

  it("returns null when no provider is usable (all disabled)", () => {
    const f = settings();
    f.rag.providers.openai.enabled = false;
    f.rag.providers.lmstudio.enabled = false;
    f.rag.providers.ollama.enabled = false;
    expect(resolveEmbeddingProvider(f, true)).toBeNull();
  });

  it("falls back to ollama when openai keyless and lmstudio disabled", () => {
    const f = settings();
    f.rag.providers.lmstudio.enabled = false;
    f.rag.providers.ollama.enabled = true;
    const r = resolveEmbeddingProvider(f, false);
    expect(r?.provider).toBe("ollama");
  });
});
