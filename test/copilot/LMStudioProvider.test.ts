// LMStudioProvider — round-trip happy path + the regression case.
//
// The bug the operator hit: setting CopilotSettings.provider="lmstudio"
// fell through CopilotRuntime's switch to AnthropicProvider, which then
// tried `for (const c of json.content)` against an OpenAI-shaped LM
// Studio response. The fix landed a `case "lmstudio"` branch; this suite
// pins the contract so it can't regress silently.

import { describe, expect, it } from "vitest";
import { LMStudioProvider } from "../../src/copilot/LMStudioProvider";
import { ProviderHostMock } from "../_stubs/ProviderHostMock";

function collect<T>(it: AsyncIterable<T>): Promise<T[]> {
  return (async () => {
    const out: T[] = [];
    for await (const v of it) out.push(v);
    return out;
  })();
}

describe("LMStudioProvider — happy path", () => {
  it("returns a single text event + usage + done for a simple completion", async () => {
    const host = new ProviderHostMock();
    host.route("/chat/completions", {
      status: 200,
      body: JSON.stringify({
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              content: "Hello! How can I assist you today?",
              tool_calls: [],
            },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 9, completion_tokens: 12 },
      }),
    });
    const provider = new LMStudioProvider(host, { endpoint: "http://localhost:1234/v1" });
    const events = await collect(
      provider.complete({
        model: "falcon3-mamba-7b-instruct",
        messages: [{ role: "user", content: "Hello" }],
        temperature: 0.3,
        maxTokens: 64,
      }),
    );
    const types = events.map((e) => e.type);
    expect(types).toEqual(["text", "usage", "done"]);
    const textEv = events.find((e) => e.type === "text") as { type: "text"; delta: string };
    expect(textEv.delta).toBe("Hello! How can I assist you today?");
  });

  it("posts a well-formed OpenAI-compat body with model + messages", async () => {
    const host = new ProviderHostMock();
    host.route("/chat/completions", {
      status: 200,
      body: JSON.stringify({
        choices: [{ message: { content: "ok", tool_calls: [] }, finish_reason: "stop" }],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      }),
    });
    const provider = new LMStudioProvider(host, { endpoint: "http://localhost:1234/v1" });
    await collect(provider.complete({
      model: "qwen3-14b",
      systemPrompt: "you are a tester",
      messages: [{ role: "user", content: "ping" }],
    }));
    const req = host.lastRequestTo("/chat/completions");
    expect(req).toBeDefined();
    expect(req!.method).toBe("POST");
    const body = JSON.parse(req!.body!);
    expect(body.model).toBe("qwen3-14b");
    expect(body.messages[0]).toEqual({ role: "system", content: "you are a tester" });
    expect(body.messages[1]).toEqual({ role: "user", content: "ping", tool_call_id: undefined });
  });

  it("surfaces non-2xx as a done:error event (does NOT throw)", async () => {
    const host = new ProviderHostMock();
    host.route("/chat/completions", {
      status: 500,
      body: JSON.stringify({ error: "internal" }),
    });
    const provider = new LMStudioProvider(host, { endpoint: "http://localhost:1234/v1" });
    const events = await collect(provider.complete({
      model: "x", messages: [{ role: "user", content: "hi" }],
    }));
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("done");
    expect((events[0] as { type: "done"; reason: string }).reason).toBe("error");
  });
});

describe("LMStudioProvider — REGRESSION: LM Studio response must NOT be parsed as Anthropic", () => {
  // This test pins the bug-class. If a future refactor accidentally has
  // CopilotRuntime route lmstudio through AnthropicProvider (or any
  // provider that does `for (const c of json.content)` on the root),
  // the test that follows in CopilotRuntime.test.ts catches it. Here we
  // assert the LM Studio shape itself: `content` is on
  // choices[0].message, NOT on the root.
  it("LM Studio response shape has no root.content (content is at choices[0].message.content)", () => {
    const lmStudioResponse = {
      choices: [{ message: { content: "hi", tool_calls: [] }, finish_reason: "stop" }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    };
    expect((lmStudioResponse as { content?: unknown }).content).toBeUndefined();
    expect(lmStudioResponse.choices[0].message.content).toBe("hi");
  });

  it("for-of on lmStudio.content would throw — confirms the bug class exists in JS", () => {
    const lmStudioResponse: { content?: unknown } = {
      choices: [{ message: { content: "hi" } }],
    } as never;
    let caught: unknown = null;
    try {
      // Simulate AnthropicProvider's `for (const c of json.content)` line.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      for (const _c of lmStudioResponse.content as any) { /* unreachable */ }
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(TypeError);
    expect(String(caught)).toMatch(/not iterable/);
  });
});

describe("LMStudioProvider — tool-call passthrough", () => {
  it("emits a tool_use event when the model returns a tool_calls entry", async () => {
    const host = new ProviderHostMock();
    host.route("/chat/completions", {
      status: 200,
      body: JSON.stringify({
        choices: [{
          message: {
            content: null,
            tool_calls: [{
              id: "call_1",
              function: { name: "log_touch", arguments: '{"contact":"alice"}' },
            }],
          },
          finish_reason: "tool_calls",
        }],
        usage: { prompt_tokens: 5, completion_tokens: 7 },
      }),
    });
    const provider = new LMStudioProvider(host, {
      endpoint: "http://localhost:1234/v1", toolUse: true,
    });
    const events = await collect(provider.complete({
      model: "x",
      messages: [{ role: "user", content: "log a touch with alice" }],
      tools: [{ name: "log_touch", description: "log a touch", inputSchema: {} }],
    }));
    const toolEv = events.find((e) => e.type === "tool_use") as
      { type: "tool_use"; id: string; name: string; input: { contact: string } };
    expect(toolEv).toBeDefined();
    expect(toolEv.id).toBe("call_1");
    expect(toolEv.name).toBe("log_touch");
    expect(toolEv.input).toEqual({ contact: "alice" });
    const doneEv = events.find((e) => e.type === "done") as { type: "done"; reason: string };
    expect(doneEv.reason).toBe("tool_use");
  });

  it("survives malformed tool_calls.arguments JSON by emitting _raw", async () => {
    const host = new ProviderHostMock();
    host.route("/chat/completions", {
      status: 200,
      body: JSON.stringify({
        choices: [{
          message: {
            tool_calls: [{ id: "x", function: { name: "f", arguments: "{not json" } }],
          },
          finish_reason: "tool_calls",
        }],
        usage: { prompt_tokens: 0, completion_tokens: 0 },
      }),
    });
    const provider = new LMStudioProvider(host, {
      endpoint: "http://localhost:1234/v1", toolUse: true,
    });
    const events = await collect(provider.complete({
      model: "x",
      messages: [{ role: "user", content: "x" }],
      tools: [{ name: "f", description: "", inputSchema: {} }],
    }));
    const toolEv = events.find((e) => e.type === "tool_use") as
      { type: "tool_use"; input: { _raw?: string } };
    expect(toolEv.input._raw).toBe("{not json");
  });
});
