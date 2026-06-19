// SauceBotRuntime — the provider-selection path is the load-bearing piece
// that broke and ate hours of debugging. Since CON-SAUCEBOT S1, provider
// construction derives from the ProviderRegistry (buildProvider) instead of a
// hardcoded switch; openai/lmstudio/nim/openrouter/groq/gemini all share the
// OpenAICompatibleProvider harness. These tests pin which provider class +
// endpoint the runtime resolves per `settings.provider`, and that an unknown
// id still falls back to anthropic (no crash in the chat path).

import { describe, expect, it } from "vitest";
import {
  SauceBotRuntime,
  type SauceBotSettings,
} from "../../src/saucebot/SauceBotRuntime";
import { OpenAICompatibleProvider } from "../../src/saucebot/OpenAICompatibleProvider";
import { AnthropicProvider } from "../../src/saucebot/AnthropicProvider";
import { OllamaProvider } from "../../src/saucebot/OllamaProvider";

// Minimal App + EntityService + SearchService stubs — SauceBotRuntime
// only uses them to construct RagAssembler which we don't exercise here.
function stubs() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const app = { vault: {}, metadataCache: {} } as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const entities = {} as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const search = {} as any;
  return { app, entities, search };
}

function makeSettings(
  provider: SauceBotSettings["provider"],
): SauceBotSettings {
  return {
    provider,
    model: "test-model",
    apiKey: "key",
    temperature: 0.3,
    maxTokens: 100,
    systemPrompt: "test",
  };
}

describe("SauceBotRuntime.provider() — registry-derived wiring", () => {
  it("provider=lmstudio builds the shared OpenAI-compat harness named 'lmstudio'", () => {
    const { app, entities, search } = stubs();
    const rt = new SauceBotRuntime(
      app,
      entities,
      search,
      makeSettings("lmstudio"),
    );
    const p = rt.provider();
    expect(p).toBeInstanceOf(OpenAICompatibleProvider);
    expect(p.name).toBe("lmstudio");
  });

  it("provider=anthropic builds AnthropicProvider (distinct event taxonomy)", () => {
    const { app, entities, search } = stubs();
    const rt = new SauceBotRuntime(
      app,
      entities,
      search,
      makeSettings("anthropic"),
    );
    expect(rt.provider()).toBeInstanceOf(AnthropicProvider);
  });

  it("provider=openai builds the shared harness named 'openai'", () => {
    const { app, entities, search } = stubs();
    const rt = new SauceBotRuntime(
      app,
      entities,
      search,
      makeSettings("openai"),
    );
    const p = rt.provider();
    expect(p).toBeInstanceOf(OpenAICompatibleProvider);
    expect(p.name).toBe("openai");
  });

  it("provider=ollama builds OllamaProvider", () => {
    const { app, entities, search } = stubs();
    const rt = new SauceBotRuntime(
      app,
      entities,
      search,
      makeSettings("ollama"),
    );
    expect(rt.provider()).toBeInstanceOf(OllamaProvider);
  });

  it("provider=groq (new cloud config) builds the shared harness named 'groq'", () => {
    const { app, entities, search } = stubs();
    const rt = new SauceBotRuntime(app, entities, search, makeSettings("groq"));
    const p = rt.provider();
    expect(p).toBeInstanceOf(OpenAICompatibleProvider);
    expect(p.name).toBe("groq");
  });

  it("unknown provider falls back to AnthropicProvider (NOT lmstudio, NOT a crash)", () => {
    const { app, entities, search } = stubs();
    const bad = makeSettings("anthropic");
    (bad as unknown as { provider: string }).provider = "totally-fake";
    const rt = new SauceBotRuntime(app, entities, search, bad);
    expect(rt.provider()).toBeInstanceOf(AnthropicProvider);
  });

  it("memoizes the provider instance across calls (no re-new per ask)", () => {
    const { app, entities, search } = stubs();
    const rt = new SauceBotRuntime(
      app,
      entities,
      search,
      makeSettings("openai"),
    );
    expect(rt.provider()).toBe(rt.provider());
  });

  it("invalidates the cached instance after updateSettings", () => {
    const { app, entities, search } = stubs();
    const rt = new SauceBotRuntime(
      app,
      entities,
      search,
      makeSettings("openai"),
    );
    const first = rt.provider();
    rt.updateSettings({ provider: "anthropic" });
    const second = rt.provider();
    expect(second).not.toBe(first);
    expect(second).toBeInstanceOf(AnthropicProvider);
  });
});

describe("SauceBotRuntime.provider() — endpoint hydration", () => {
  it("lmstudio default endpoint is http://localhost:1234/v1 when baseUrl unset", () => {
    const { app, entities, search } = stubs();
    const rt = new SauceBotRuntime(
      app,
      entities,
      search,
      makeSettings("lmstudio"),
    );
    const p = rt.provider() as OpenAICompatibleProvider;
    expect(p.endpoint).toBe("http://localhost:1234/v1");
  });

  it("lmstudio honors operator-overridden baseUrl", () => {
    const { app, entities, search } = stubs();
    const s = {
      ...makeSettings("lmstudio"),
      baseUrl: "http://10.0.0.5:9999/v1",
    };
    const rt = new SauceBotRuntime(app, entities, search, s);
    const p = rt.provider() as OpenAICompatibleProvider;
    expect(p.endpoint).toBe("http://10.0.0.5:9999/v1");
  });
});
