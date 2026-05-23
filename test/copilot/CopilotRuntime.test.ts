// CopilotRuntime — the provider-selection switch is the load-bearing
// piece that broke and ate hours of debugging. These tests pin which
// provider class gets constructed per `settings.provider` value.

import { describe, expect, it } from "vitest";
import { CopilotRuntime, type CopilotSettings } from "../../src/copilot/CopilotRuntime";
import { LMStudioProvider } from "../../src/copilot/LMStudioProvider";
import { AnthropicProvider } from "../../src/copilot/AnthropicProvider";
import { OpenAIProvider } from "../../src/copilot/OpenAIProvider";
import { OllamaProvider } from "../../src/copilot/OllamaProvider";

// Minimal App + EntityService + SearchService stubs — CopilotRuntime
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

function makeSettings(provider: CopilotSettings["provider"]): CopilotSettings {
  return {
    provider,
    model: "test-model",
    apiKey: "key",
    temperature: 0.3,
    maxTokens: 100,
    systemPrompt: "test",
  };
}

describe("CopilotRuntime.provider() — switch wiring", () => {
  it("provider=lmstudio constructs LMStudioProvider (regression test for s.content bug)", () => {
    const { app, entities, search } = stubs();
    const rt = new CopilotRuntime(app, entities, search, makeSettings("lmstudio"));
    const p = rt.provider();
    expect(p).toBeInstanceOf(LMStudioProvider);
    expect(p.name).toBe("lmstudio");
  });

  it("provider=anthropic constructs AnthropicProvider", () => {
    const { app, entities, search } = stubs();
    const rt = new CopilotRuntime(app, entities, search, makeSettings("anthropic"));
    expect(rt.provider()).toBeInstanceOf(AnthropicProvider);
  });

  it("provider=openai constructs OpenAIProvider", () => {
    const { app, entities, search } = stubs();
    const rt = new CopilotRuntime(app, entities, search, makeSettings("openai"));
    expect(rt.provider()).toBeInstanceOf(OpenAIProvider);
  });

  it("provider=ollama constructs OllamaProvider", () => {
    const { app, entities, search } = stubs();
    const rt = new CopilotRuntime(app, entities, search, makeSettings("ollama"));
    expect(rt.provider()).toBeInstanceOf(OllamaProvider);
  });

  it("unknown provider falls back to AnthropicProvider (NOT lmstudio)", () => {
    const { app, entities, search } = stubs();
    // Cast-through-unknown lets us test the default branch.
    const bad = makeSettings("anthropic");
    (bad as unknown as { provider: string }).provider = "totally-fake";
    const rt = new CopilotRuntime(app, entities, search, bad);
    // Fallthrough goes to Anthropic — historical default.
    expect(rt.provider()).toBeInstanceOf(AnthropicProvider);
  });
});

describe("CopilotRuntime.provider() — settings hydration", () => {
  it("lmstudio default endpoint is http://localhost:1234/v1 when baseUrl unset", () => {
    const { app, entities, search } = stubs();
    const s = makeSettings("lmstudio");
    const rt = new CopilotRuntime(app, entities, search, s);
    const p = rt.provider() as LMStudioProvider;
    expect(p.getConfig().endpoint).toBe("http://localhost:1234/v1");
  });

  it("lmstudio honors operator-overridden baseUrl", () => {
    const { app, entities, search } = stubs();
    const s = { ...makeSettings("lmstudio"), baseUrl: "http://10.0.0.5:9999/v1" };
    const rt = new CopilotRuntime(app, entities, search, s);
    const p = rt.provider() as LMStudioProvider;
    expect(p.getConfig().endpoint).toBe("http://10.0.0.5:9999/v1");
  });
});
