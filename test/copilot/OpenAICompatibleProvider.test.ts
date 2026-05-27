// OpenAICompatibleProvider — the shared OpenAI-compatible harness that
// OpenAIProvider / LMStudioProvider / nim / openrouter / groq / gemini all
// collapse onto. Pins the body builder, SSE tool-call streaming loop, batch
// fallback, finish-reason map, /embeddings, and the auth-header + tool-gate
// knobs that distinguish one config from another.

import { describe, expect, it } from "vitest";
import { OpenAICompatibleProvider } from "../../src/saucebot/OpenAICompatibleProvider";
import { ProviderHostMock } from "../_stubs/ProviderHostMock";

async function collect<T>(it: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const v of it) out.push(v);
  return out;
}

function sseFrames(): string[] {
  const lines = [
    `data: ${JSON.stringify({ choices: [{ delta: { role: "assistant" }, finish_reason: null }] })}\n\n`,
    `data: ${JSON.stringify({ choices: [{ delta: { content: "Foo" }, finish_reason: null }] })}\n\n`,
    `data: ${JSON.stringify({ choices: [{ delta: { content: " bar" }, finish_reason: null }] })}\n\n`,
    `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 2, completion_tokens: 3 } })}\n\n`,
    `data: [DONE]\n\n`,
  ];
  return [lines.join("")];
}

describe("OpenAICompatibleProvider — identity from spec", () => {
  it("derives name + capabilities from the spec", () => {
    const host = new ProviderHostMock();
    const p = new OpenAICompatibleProvider(host, {
      name: "groq",
      baseUrl: "https://api.groq.com/openai/v1",
      apiKey: async () => "gsk-x",
      maxContext: 64_000,
    });
    expect(p.name).toBe("groq");
    const caps = p.capabilities();
    expect(caps.toolUse).toBe(true);
    expect(caps.streaming).toBe(true);
    expect(caps.maxContext).toBe(64_000);
  });

  it("exposes the trailing-slash-normalized base URL via .endpoint", () => {
    const host = new ProviderHostMock();
    const p = new OpenAICompatibleProvider(host, {
      name: "lmstudio",
      baseUrl: "http://localhost:1234/v1/",
    });
    expect(p.endpoint).toBe("http://localhost:1234/v1");
  });
});

describe("OpenAICompatibleProvider — batch path", () => {
  it("emits text + usage + done from a single non-stream response", async () => {
    const host = new ProviderHostMock();
    host.route("/chat/completions", {
      status: 200,
      body: JSON.stringify({
        choices: [{ message: { content: "hi there" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 4, completion_tokens: 2 },
      }),
    });
    const p = new OpenAICompatibleProvider(host, {
      name: "openai",
      baseUrl: "https://api.openai.com/v1",
      apiKey: async () => "sk-test",
    });
    const events = await collect(
      p.complete({ model: "gpt-4o-mini", messages: [{ role: "user", content: "hi" }] }),
    );
    expect(events.map((e) => e.type)).toEqual(["text", "usage", "done"]);
    expect((events[2] as { reason: string }).reason).toBe("end_turn");
  });

  it("maps req.messages with a tool_call_id key and prepends the system prompt", async () => {
    const host = new ProviderHostMock();
    host.route("/chat/completions", {
      status: 200,
      body: JSON.stringify({
        choices: [{ message: { content: "ok" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      }),
    });
    const p = new OpenAICompatibleProvider(host, {
      name: "lmstudio",
      baseUrl: "http://localhost:1234/v1",
    });
    await collect(
      p.complete({
        model: "qwen3-14b",
        systemPrompt: "you are a tester",
        messages: [{ role: "user", content: "ping" }],
      }),
    );
    const body = JSON.parse(host.lastRequestTo("/chat/completions")!.body!);
    expect(body.model).toBe("qwen3-14b");
    expect(body.messages[0]).toEqual({ role: "system", content: "you are a tester" });
    expect(body.messages[1]).toEqual({ role: "user", content: "ping", tool_call_id: undefined });
  });

  it("surfaces non-2xx as a done:error event (does NOT throw)", async () => {
    const host = new ProviderHostMock();
    host.route("/chat/completions", { status: 500, body: JSON.stringify({ error: "internal" }) });
    const p = new OpenAICompatibleProvider(host, { name: "openai", baseUrl: "http://x/v1" });
    const events = await collect(p.complete({ model: "x", messages: [{ role: "user", content: "hi" }] }));
    expect(events).toHaveLength(1);
    expect((events[0] as { reason: string }).reason).toBe("error");
  });
});

describe("OpenAICompatibleProvider — SSE streaming", () => {
  it("yields token-by-token deltas, then usage + done", async () => {
    const host = new ProviderHostMock();
    host.routeStream("/chat/completions", { status: 200, chunks: sseFrames() });
    const p = new OpenAICompatibleProvider(host, { name: "openai", baseUrl: "http://x/v1", apiKey: async () => "k" });
    const events = await collect(
      p.complete({ model: "gpt-4o-mini", messages: [{ role: "user", content: "hi" }], stream: true }),
    );
    const texts = events.filter((e) => e.type === "text") as Array<{ delta: string }>;
    expect(texts.map((t) => t.delta)).toEqual(["Foo", " bar"]);
    expect((events.find((e) => e.type === "done") as { reason: string }).reason).toBe("end_turn");
    expect(JSON.parse(host.lastRequestTo("/chat/completions")!.body!).stream).toBe(true);
  });

  it("assembles split tool_calls and emits a parsed tool_use event", async () => {
    const host = new ProviderHostMock();
    const lines = [
      `data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: "call_1", function: { name: "log_touch", arguments: "" } }] }, finish_reason: null }] })}\n\n`,
      `data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '{"con' } }] }, finish_reason: null }] })}\n\n`,
      `data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: 'tact":"alice"}' } }] }, finish_reason: null }] })}\n\n`,
      `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "tool_calls" }], usage: { prompt_tokens: 1, completion_tokens: 2 } })}\n\n`,
      `data: [DONE]\n\n`,
    ];
    host.routeStream("/chat/completions", { status: 200, chunks: lines });
    const p = new OpenAICompatibleProvider(host, { name: "lmstudio", baseUrl: "http://x/v1" });
    const events = await collect(
      p.complete({
        model: "x",
        messages: [{ role: "user", content: "go" }],
        stream: true,
        tools: [{ name: "log_touch", description: "", inputSchema: {} }],
      }),
    );
    const tu = events.find((e) => e.type === "tool_use") as { id: string; name: string; input: { contact: string } };
    expect(tu.id).toBe("call_1");
    expect(tu.name).toBe("log_touch");
    expect(tu.input).toEqual({ contact: "alice" });
    expect((events.find((e) => e.type === "done") as { reason: string }).reason).toBe("tool_use");
  });

  it("yields done:error on HTTP 5xx in stream branch (does NOT throw)", async () => {
    const host = new ProviderHostMock();
    host.routeStream("/chat/completions", { status: 500, chunks: [JSON.stringify({ error: "boom" })] });
    const p = new OpenAICompatibleProvider(host, { name: "openai", baseUrl: "http://x/v1" });
    const events = await collect(p.complete({ model: "x", messages: [{ role: "user", content: "x" }], stream: true }));
    expect(events).toHaveLength(1);
    expect((events[0] as { reason: string }).reason).toBe("error");
  });
});

describe("OpenAICompatibleProvider — auth header + tool gate knobs", () => {
  it("sends a bearer auth header when an apiKey getter resolves a value", async () => {
    const host = new ProviderHostMock();
    host.route("/chat/completions", {
      status: 200,
      body: JSON.stringify({ choices: [{ message: { content: "x" }, finish_reason: "stop" }], usage: {} }),
    });
    const p = new OpenAICompatibleProvider(host, { name: "openai", baseUrl: "http://x/v1", apiKey: async () => "sk-secret" });
    await collect(p.complete({ model: "m", messages: [{ role: "user", content: "hi" }] }));
    expect(host.lastRequestTo("/chat/completions")!.headers.authorization).toBe("Bearer sk-secret");
  });

  it("omits the auth header when authHeader is 'none' (local LM Studio default)", async () => {
    const host = new ProviderHostMock();
    host.route("/chat/completions", {
      status: 200,
      body: JSON.stringify({ choices: [{ message: { content: "x" }, finish_reason: "stop" }], usage: {} }),
    });
    const p = new OpenAICompatibleProvider(host, { name: "lmstudio", baseUrl: "http://x/v1", authHeader: "none" });
    await collect(p.complete({ model: "m", messages: [{ role: "user", content: "hi" }] }));
    expect(host.lastRequestTo("/chat/completions")!.headers.authorization).toBeUndefined();
  });

  it("does NOT send tools in the body when supportsToolUse is false", async () => {
    const host = new ProviderHostMock();
    host.route("/chat/completions", {
      status: 200,
      body: JSON.stringify({ choices: [{ message: { content: "x" }, finish_reason: "stop" }], usage: {} }),
    });
    const p = new OpenAICompatibleProvider(host, { name: "lmstudio", baseUrl: "http://x/v1", supportsToolUse: false });
    await collect(
      p.complete({ model: "m", messages: [{ role: "user", content: "hi" }], tools: [{ name: "t", description: "", inputSchema: {} }] }),
    );
    expect(JSON.parse(host.lastRequestTo("/chat/completions")!.body!).tools).toBeUndefined();
    expect(p.capabilities().toolUse).toBe(false);
  });
});

describe("OpenAICompatibleProvider — embeddings", () => {
  it("posts {model,input} to /embeddings and returns a Float32Array", async () => {
    const host = new ProviderHostMock();
    host.route("/embeddings", { status: 200, body: JSON.stringify({ data: [{ embedding: [0.1, 0.2, 0.3] }] }) });
    const p = new OpenAICompatibleProvider(host, { name: "openai", baseUrl: "http://x/v1", apiKey: async () => "k" });
    const vec = await p.embed("hello", "text-embedding-3-small");
    expect(vec).toBeInstanceOf(Float32Array);
    expect(Array.from(vec)).toHaveLength(3);
    const body = JSON.parse(host.lastRequestTo("/embeddings")!.body!);
    expect(body).toEqual({ model: "text-embedding-3-small", input: "hello" });
  });

  it("throws on embeddings when supportsEmbeddings is false", async () => {
    const host = new ProviderHostMock();
    const p = new OpenAICompatibleProvider(host, { name: "groq", baseUrl: "http://x/v1", supportsEmbeddings: false });
    await expect(p.embed("hi", "m")).rejects.toThrow();
  });
});
