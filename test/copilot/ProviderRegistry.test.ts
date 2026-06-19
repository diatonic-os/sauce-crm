// ProviderRegistry — the single source of truth for "what providers exist".
// Adding a provider = adding one PROVIDER_REGISTRY entry; the runtime, catalog,
// and UI lists all derive from here. buildProvider() is the harness factory.

import { describe, expect, it } from "vitest";
import {
  PROVIDER_REGISTRY,
  PROVIDER_IDS,
  buildProvider,
  restoreSpecPath,
  type ProviderId,
} from "../../src/saucebot/ProviderRegistry";
import { OpenAICompatibleProvider } from "../../src/saucebot/OpenAICompatibleProvider";
import { AnthropicProvider } from "../../src/saucebot/AnthropicProvider";
import { OllamaProvider } from "../../src/saucebot/OllamaProvider";
import { LMStudioSdkProvider } from "../../src/saucebot/LMStudioSdkProvider";
import { ProviderHostMock } from "../_stubs/ProviderHostMock";

async function collect<T>(it: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const v of it) out.push(v);
  return out;
}

describe("PROVIDER_REGISTRY — completeness", () => {
  it("ships the expected provider set", () => {
    expect(PROVIDER_IDS).toEqual(
      expect.arrayContaining([
        "anthropic",
        "openai",
        "ollama",
        "lmstudio",
        "lmstudio-sdk",
        "nim",
        "openrouter",
        "groq",
        "gemini",
      ]),
    );
  });

  it("every entry's id matches its record key and has a credentialKey of copilot:<id>:api-key for cloud providers", () => {
    for (const id of PROVIDER_IDS) {
      const spec = PROVIDER_REGISTRY[id];
      expect(spec.id).toBe(id);
      expect(spec.label.length).toBeGreaterThan(0);
      if (spec.kind === "cloud") {
        expect(spec.credentialKey).toBe(`copilot:${id}:api-key`);
      }
    }
  });

  it("nim, openrouter, groq, gemini are openai-compat cloud configs with embeddings+toolUse", () => {
    for (const id of ["nim", "openrouter", "groq", "gemini"] as ProviderId[]) {
      const spec = PROVIDER_REGISTRY[id];
      expect(spec.harness).toBe("openai-compat");
      expect(spec.kind).toBe("cloud");
      expect(spec.baseUrl).toMatch(/^https:\/\//);
    }
  });
});

describe("buildProvider — harness factory", () => {
  it("builds a real provider instance for every registry id", () => {
    const host = new ProviderHostMock();
    for (const id of PROVIDER_IDS) {
      const p = buildProvider(id, host, { apiKey: async () => "k" });
      expect(p.name).toBeTruthy();
      expect(typeof p.complete).toBe("function");
      expect(typeof p.capabilities).toBe("function");
    }
  });

  it("routes harness=anthropic to AnthropicProvider", () => {
    const host = new ProviderHostMock();
    expect(buildProvider("anthropic", host, {})).toBeInstanceOf(
      AnthropicProvider,
    );
  });

  it("routes harness=ollama to OllamaProvider", () => {
    const host = new ProviderHostMock();
    expect(buildProvider("ollama", host, {})).toBeInstanceOf(OllamaProvider);
  });

  it("routes harness=lmstudio-sdk to LMStudioSdkProvider", () => {
    const host = new ProviderHostMock();
    expect(buildProvider("lmstudio-sdk", host, {})).toBeInstanceOf(
      LMStudioSdkProvider,
    );
  });

  it("routes openai-compat ids to an OpenAICompatibleProvider", () => {
    const host = new ProviderHostMock();
    for (const id of [
      "openai",
      "lmstudio",
      "nim",
      "openrouter",
      "groq",
      "gemini",
    ] as ProviderId[]) {
      expect(
        buildProvider(id, host, { apiKey: async () => "k" }),
      ).toBeInstanceOf(OpenAICompatibleProvider);
    }
  });
});

describe("buildProvider — openai & lmstudio share the harness request shape", () => {
  function batchRoute(host: ProviderHostMock) {
    host.route("/chat/completions", {
      status: 200,
      body: JSON.stringify({
        choices: [{ message: { content: "ok" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      }),
    });
  }

  it("both post {model,messages} to /chat/completions and emit text+usage+done", async () => {
    const openaiHost = new ProviderHostMock();
    batchRoute(openaiHost);
    const lmHost = new ProviderHostMock();
    batchRoute(lmHost);

    const openai = buildProvider("openai", openaiHost, {
      apiKey: async () => "sk",
    });
    const lm = buildProvider("lmstudio", lmHost, {
      baseUrl: "http://localhost:1234/v1",
    });

    const oEvents = await collect(
      openai.complete({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: "hi" }],
      }),
    );
    const lEvents = await collect(
      lm.complete({
        model: "qwen3-14b",
        messages: [{ role: "user", content: "hi" }],
      }),
    );

    expect(oEvents.map((e) => e.type)).toEqual(["text", "usage", "done"]);
    expect(lEvents.map((e) => e.type)).toEqual(["text", "usage", "done"]);

    const oBody = JSON.parse(
      openaiHost.lastRequestTo("/chat/completions")!.body!,
    );
    const lBody = JSON.parse(lmHost.lastRequestTo("/chat/completions")!.body!);
    expect(Object.keys(oBody).sort()).toEqual(Object.keys(lBody).sort());
  });

  it("openai sends a bearer header; local lmstudio (no key) omits it", async () => {
    const openaiHost = new ProviderHostMock();
    batchRoute(openaiHost);
    const lmHost = new ProviderHostMock();
    batchRoute(lmHost);
    const openai = buildProvider("openai", openaiHost, {
      apiKey: async () => "sk-live",
    });
    const lm = buildProvider("lmstudio", lmHost, {
      baseUrl: "http://localhost:1234/v1",
    });
    await collect(
      openai.complete({
        model: "m",
        messages: [{ role: "user", content: "x" }],
      }),
    );
    await collect(
      lm.complete({ model: "m", messages: [{ role: "user", content: "x" }] }),
    );
    expect(
      openaiHost.lastRequestTo("/chat/completions")!.headers.authorization,
    ).toBe("Bearer sk-live");
    expect(
      lmHost.lastRequestTo("/chat/completions")!.headers.authorization,
    ).toBeUndefined();
  });
});

describe("restoreSpecPath — endpoint /v1 normalization", () => {
  it("restores the spec path when an override drops it (LM Studio autodetect)", () => {
    expect(
      restoreSpecPath("http://127.0.0.1:1234", "http://localhost:1234/v1"),
    ).toBe("http://127.0.0.1:1234/v1");
  });
  it("leaves an override that already has a path untouched", () => {
    expect(
      restoreSpecPath("http://127.0.0.1:1234/v1", "http://localhost:1234/v1"),
    ).toBe("http://127.0.0.1:1234/v1");
    expect(
      restoreSpecPath("http://proxy/custom/path", "http://localhost:1234/v1"),
    ).toBe("http://proxy/custom/path");
  });
  it("restores multi-segment spec paths (e.g. gemini's /v1beta/openai)", () => {
    expect(restoreSpecPath("https://host", "https://x/v1beta/openai")).toBe(
      "https://host/v1beta/openai",
    );
  });
  it("builds the lmstudio provider with /v1 even from a path-less override", async () => {
    const { ProviderHostMock } = await import("../_stubs/ProviderHostMock");
    const host = new ProviderHostMock();
    const p = buildProvider("lmstudio", host, {
      baseUrl: "http://127.0.0.1:1234",
    });
    expect((p as OpenAICompatibleProvider).endpoint).toBe(
      "http://127.0.0.1:1234/v1",
    );
  });
});
