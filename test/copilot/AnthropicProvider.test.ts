// AnthropicProvider — happy path + the Anthropic response shape that
// uses root.content as an array of {type, text, ...} parts.

import { describe, expect, it } from "vitest";
import { AnthropicProvider } from "../../src/copilot/AnthropicProvider";
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
      host, async () => "sk-test", "https://api.anthropic.com",
    );
    const events = await collect(provider.complete({
      model: "claude-3-5-sonnet-latest",
      messages: [{ role: "user", content: "hi" }],
    }));
    const textEvs = events.filter((e) => e.type === "text") as
      Array<{ type: "text"; delta: string }>;
    expect(textEvs).toHaveLength(1);
    expect(textEvs[0].delta).toBe("hello from claude");
    const doneEv = events.find((e) => e.type === "done") as { type: "done"; reason: string };
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
    await collect(provider.complete({
      model: "x", messages: [{ role: "user", content: "x" }],
    }));
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
          { type: "tool_use", id: "tu1", name: "log_touch", input: { contact: "alice" } },
        ],
        usage: { input_tokens: 10, output_tokens: 8 },
        stop_reason: "tool_use",
      }),
    });
    const provider = new AnthropicProvider(host, async () => "sk-test");
    const events = await collect(provider.complete({
      model: "x",
      messages: [{ role: "user", content: "log a touch with alice" }],
      tools: [{ name: "log_touch", description: "", inputSchema: {} }],
    }));
    const types = events.map((e) => e.type);
    expect(types).toContain("text");
    expect(types).toContain("tool_use");
    const doneEv = events.find((e) => e.type === "done") as { type: "done"; reason: string };
    expect(doneEv.reason).toBe("tool_use");
  });
});
