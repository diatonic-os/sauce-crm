// AnthropicProvider — happy path + the Anthropic response shape that
// uses root.content as an array of {type, text, ...} parts.

import { describe, expect, it } from "vitest";
import { AnthropicProvider } from "../../src/saucebot/AnthropicProvider";
import { ProviderHostMock } from "../_stubs/ProviderHostMock";

function collect<T>(it: AsyncIterable<T>): Promise<T[]> {
  return (async () => {
    const out: T[] = [];
    for await (const v of it) out.push(v);
    return out;
  })();
}

describe("AnthropicProvider", () => {
  it("parses a text-only Anthropic response into text events", async () => {
    const host = new ProviderHostMock();
    host.route("/messages", {
      status: 200,
      body: JSON.stringify({
        content: [{ type: "text", text: "hello from claude" }],
        usage: { input_tokens: 5, output_tokens: 3 },
        stop_reason: "end_turn",
      }),
    });
    const provider = new AnthropicProvider(
      host,
      async () => "sk-test",
      "https://api.anthropic.com",
    );
    const events = await collect(
      provider.complete({
        model: "claude-3-5-sonnet-latest",
        messages: [{ role: "user", content: "hi" }],
      }),
    );
    const textEvs = events.filter((e) => e.type === "text") as Array<{
      type: "text";
      delta: string;
    }>;
    expect(textEvs).toHaveLength(1);
    expect(textEvs[0].delta).toBe("hello from claude");
    const doneEv = events.find((e) => e.type === "done") as {
      type: "done";
      reason: string;
    };
    expect(doneEv.reason).toBe("end_turn");
  });

  it("sends x-api-key header (not Authorization Bearer)", async () => {
    const host = new ProviderHostMock();
    host.route("/messages", {
      status: 200,
      body: JSON.stringify({
        content: [{ type: "text", text: "x" }],
        usage: { input_tokens: 1, output_tokens: 1 },
        stop_reason: "end_turn",
      }),
    });
    const provider = new AnthropicProvider(host, async () => "sk-secret");
    await collect(
      provider.complete({
        model: "x",
        messages: [{ role: "user", content: "x" }],
      }),
    );
    const req = host.lastRequestTo("/messages");
    expect(req?.headers["x-api-key"]).toBe("sk-secret");
    expect(req?.headers.authorization).toBeUndefined();
  });

  it("handles tool_use parts in the content array", async () => {
    const host = new ProviderHostMock();
    host.route("/messages", {
      status: 200,
      body: JSON.stringify({
        content: [
          { type: "text", text: "I'll log that." },
          {
            type: "tool_use",
            id: "tu1",
            name: "log_touch",
            input: { contact: "alice" },
          },
        ],
        usage: { input_tokens: 10, output_tokens: 8 },
        stop_reason: "tool_use",
      }),
    });
    const provider = new AnthropicProvider(host, async () => "sk-test");
    const events = await collect(
      provider.complete({
        model: "x",
        messages: [{ role: "user", content: "log a touch with alice" }],
        tools: [{ name: "log_touch", description: "", inputSchema: {} }],
      }),
    );
    const types = events.map((e) => e.type);
    expect(types).toContain("text");
    expect(types).toContain("tool_use");
    const doneEv = events.find((e) => e.type === "done") as {
      type: "done";
      reason: string;
    };
    expect(doneEv.reason).toBe("tool_use");
  });
});

describe("AnthropicProvider — SSE streaming", () => {
  function evt(name: string, data: unknown): string {
    return `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`;
  }
  function textStream(): string[] {
    const all =
      evt("message_start", { message: { usage: { input_tokens: 7 } } }) +
      evt("content_block_start", {
        index: 0,
        content_block: { type: "text", text: "" },
      }) +
      evt("content_block_delta", {
        index: 0,
        delta: { type: "text_delta", text: "Hel" },
      }) +
      evt("content_block_delta", {
        index: 0,
        delta: { type: "text_delta", text: "lo" },
      }) +
      evt("content_block_delta", {
        index: 0,
        delta: { type: "text_delta", text: " world" },
      }) +
      evt("content_block_stop", { index: 0 }) +
      evt("message_delta", {
        delta: { stop_reason: "end_turn" },
        usage: { output_tokens: 3 },
      }) +
      evt("message_stop", {});
    // Chunk it aggressively to test buffering across event boundaries.
    const chunks: string[] = [];
    for (let i = 0; i < all.length; i += 11) chunks.push(all.slice(i, i + 11));
    return chunks;
  }

  it("emits text deltas, usage, and done from Anthropic SSE", async () => {
    const host = new ProviderHostMock();
    host.routeStream("/messages", { status: 200, chunks: textStream() });
    const provider = new AnthropicProvider(host, async () => "sk-test");
    const events = await collect(
      provider.complete({
        model: "claude-opus-4-7",
        messages: [{ role: "user", content: "hi" }],
        stream: true,
      }),
    );
    const texts = events.filter((e) => e.type === "text") as Array<{
      type: "text";
      delta: string;
    }>;
    expect(texts.map((t) => t.delta)).toEqual(["Hel", "lo", " world"]);
    const usage = events.find((e) => e.type === "usage") as {
      type: "usage";
      inputTokens: number;
      outputTokens: number;
    };
    expect(usage.inputTokens).toBe(7);
    expect(usage.outputTokens).toBe(3);
    const done = events.find((e) => e.type === "done") as {
      type: "done";
      reason: string;
    };
    expect(done.reason).toBe("end_turn");
  });

  it("assembles streamed tool_use input_json_delta chunks", async () => {
    const host = new ProviderHostMock();
    const all =
      evt("message_start", { message: { usage: { input_tokens: 4 } } }) +
      evt("content_block_start", {
        index: 0,
        content_block: { type: "tool_use", id: "toolu_1", name: "log_touch" },
      }) +
      evt("content_block_delta", {
        index: 0,
        delta: { type: "input_json_delta", partial_json: '{"con' },
      }) +
      evt("content_block_delta", {
        index: 0,
        delta: { type: "input_json_delta", partial_json: 'tact":"alice"}' },
      }) +
      evt("content_block_stop", { index: 0 }) +
      evt("message_delta", {
        delta: { stop_reason: "tool_use" },
        usage: { output_tokens: 9 },
      }) +
      evt("message_stop", {});
    host.routeStream("/messages", { status: 200, chunks: [all] });
    const provider = new AnthropicProvider(host, async () => "sk-test");
    const events = await collect(
      provider.complete({
        model: "claude-opus-4-7",
        messages: [{ role: "user", content: "go" }],
        stream: true,
        tools: [{ name: "log_touch", description: "", inputSchema: {} }],
      }),
    );
    const tu = events.find((e) => e.type === "tool_use") as {
      type: "tool_use";
      id: string;
      name: string;
      input: { contact: string };
    };
    expect(tu.id).toBe("toolu_1");
    expect(tu.name).toBe("log_touch");
    expect(tu.input).toEqual({ contact: "alice" });
    const done = events.find((e) => e.type === "done") as {
      type: "done";
      reason: string;
    };
    expect(done.reason).toBe("tool_use");
  });

  it("yields done:error on 4xx without throwing", async () => {
    const host = new ProviderHostMock();
    host.routeStream("/messages", {
      status: 401,
      chunks: [JSON.stringify({ error: "unauth" })],
    });
    const provider = new AnthropicProvider(host, async () => "sk-test");
    const events = await collect(
      provider.complete({
        model: "claude-opus-4-7",
        messages: [{ role: "user", content: "hi" }],
        stream: true,
      }),
    );
    expect(events).toHaveLength(1);
    expect((events[0] as { type: "done"; reason: string }).reason).toBe(
      "error",
    );
  });
});
