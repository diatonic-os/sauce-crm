import { describe, expect, it } from "vitest";
import {
  DEFAULT_FEATURE_SETTINGS,
  mergeFeatureSettings,
  activeEmbeddingProvider,
} from "../../src/settings/FeatureSettings";

describe("mergeFeatureSettings", () => {
  it("returns defaults for undefined", () => {
    expect(mergeFeatureSettings(undefined)).toEqual(DEFAULT_FEATURE_SETTINGS);
  });

  it("keeps default sub-keys when a partial blob is loaded", () => {
    const merged = mergeFeatureSettings({ rag: { enabled: true } } as never);
    expect(merged.rag.enabled).toBe(true);
    // untouched sub-keys retain defaults (provider default is now OpenAI, which
    // resolveEmbeddingProvider key-gates with a local fallback)
    expect(merged.rag.provider).toBe("openai");
    expect(merged.rag.providers.ollama.model).toBe("nomic-embed-text");
    expect(merged.enrichment).toEqual(DEFAULT_FEATURE_SETTINGS.enrichment);
  });

  it("deep-merges a single provider override without dropping siblings", () => {
    const merged = mergeFeatureSettings({
      rag: { providers: { openai: { model: "text-embedding-3-large" } } },
    } as never);
    expect(merged.rag.providers.openai.model).toBe("text-embedding-3-large");
    expect(merged.rag.providers.openai.endpoint).toBe(
      "https://api.openai.com/v1",
    );
    expect(merged.rag.providers.lmstudio.enabled).toBe(true);
  });
});

describe("activeEmbeddingProvider", () => {
  it("is null when RAG is disabled", () => {
    const f = mergeFeatureSettings({ rag: { enabled: false } } as never);
    expect(activeEmbeddingProvider(f)).toBeNull();
  });

  it("is null when the selected provider has no model", () => {
    const f = mergeFeatureSettings({
      rag: {
        enabled: true,
        provider: "lmstudio",
        providers: { lmstudio: { enabled: true, model: "" } },
      },
    } as never);
    expect(activeEmbeddingProvider(f)).toBeNull();
  });

  it("resolves the selected provider when enabled with a model", () => {
    const f = mergeFeatureSettings({
      rag: {
        enabled: true,
        provider: "ollama",
        providers: { ollama: { enabled: true, model: "nomic-embed-text" } },
      },
    } as never);
    const active = activeEmbeddingProvider(f);
    expect(active?.provider).toBe("ollama");
    expect(active?.config.model).toBe("nomic-embed-text");
  });

  it("is null when the selected provider is disabled", () => {
    const f = mergeFeatureSettings({
      rag: {
        enabled: true,
        provider: "openai",
        providers: { openai: { enabled: false, model: "x" } },
      },
    } as never);
    expect(activeEmbeddingProvider(f)).toBeNull();
  });
});

describe("mergeFeatureSettings — localLLM", () => {
  it("provides default Ollama + LM Studio config", () => {
    const m = mergeFeatureSettings(undefined);
    expect(m.localLLM.ollama.endpoint).toBe("http://localhost:11434");
    expect(m.localLLM.lmstudio.endpoint).toBe("http://localhost:1234/v1");
  });

  it("deep-merges one local provider without dropping the other", () => {
    const m = mergeFeatureSettings({
      localLLM: { ollama: { model: "llama3.1:8b" } },
    } as never);
    expect(m.localLLM.ollama.model).toBe("llama3.1:8b");
    expect(m.localLLM.ollama.endpoint).toBe("http://localhost:11434"); // default kept
    expect(m.localLLM.lmstudio.endpoint).toBe("http://localhost:1234/v1"); // sibling kept
  });
});
