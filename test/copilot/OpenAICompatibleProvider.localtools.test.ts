// Local-model tool-call robustness in the OpenAI-compatible provider:
//  - tolerant parse of malformed/fenced tool-call arguments
//  - salvage of a tool call the model emitted as plain TEXT content
// These close a large slice of the local-vs-cloud tool-use gap. Existing
// well-formed behavior (OpenAICompatibleProvider.test.ts) must be unaffected.

import { describe, expect, it } from "vitest";
import { OpenAICompatibleProvider } from "../../src/saucebot/OpenAICompatibleProvider";
import { ProviderHostMock } from "../_stubs/ProviderHostMock";
import type { CompletionEvent } from "../../src/saucebot/ISauceBotProvider";

async function collect(it: AsyncIterable<CompletionEvent>): Promise<CompletionEvent[]> {
  const out: CompletionEvent[] = [];
  for await (const v of it) out.push(v);
  return out;
}

describe("OpenAICompatibleProvider — local tool robustness (batch)", () => {
  it("tolerates malformed tool-call args (trailing comma) instead of {_raw}", async () => {
    const host = new ProviderHostMock();
    host.route("/chat/completions", {
      status: 200,
      body: JSON.stringify({
        choices: [
          {
            message: {
              content: "",
              tool_calls: [
                { id: "c1", function: { name: "read_note", arguments: '{"path":"a.md",}' } },
              ],
            },
            finish_reason: "tool_calls",
          },
        ],
        usage: {},
      }),
    });
    const p = new OpenAICompatibleProvider(host, { name: "lmstudio", baseUrl: "http://x/v1" });
    const events = await collect(
      p.complete({
        model: "qwen3-14b",
        messages: [{ role: "user", content: "go" }],
        tools: [{ name: "read_note", description: "", inputSchema: {} }],
      }),
    );
    const tu = events.find((e) => e.type === "tool_use") as { input: unknown };
    expect(tu.input).toEqual({ path: "a.md" });
  });

  it("salvages a tool call emitted as plain text content", async () => {
    const host = new ProviderHostMock();
    host.route("/chat/completions", {
      status: 200,
      body: JSON.stringify({
        choices: [
          {
            message: { content: 'read_note({"path":"people/alice.md"})' },
            finish_reason: "stop",
          },
        ],
        usage: {},
      }),
    });
    const p = new OpenAICompatibleProvider(host, { name: "lmstudio", baseUrl: "http://x/v1" });
    const events = await collect(
      p.complete({
        model: "qwen3-14b",
        messages: [{ role: "user", content: "read alice" }],
        tools: [{ name: "read_note", description: "", inputSchema: {} }],
      }),
    );
    const tu = events.find((e) => e.type === "tool_use") as { name: string; input: unknown };
    expect(tu).toBeDefined();
    expect(tu.name).toBe("read_note");
    expect(tu.input).toEqual({ path: "people/alice.md" });
    // finish reason promoted to tool_use so the loop continues.
    const done = events.find((e) => e.type === "done") as { reason: string };
    expect(done.reason).toBe("tool_use");
  });

  it("does NOT mistake ordinary prose for a tool call", async () => {
    const host = new ProviderHostMock();
    host.route("/chat/completions", {
      status: 200,
      body: JSON.stringify({
        choices: [{ message: { content: "Alice is a ranking lead at Acme." }, finish_reason: "stop" }],
        usage: {},
      }),
    });
    const p = new OpenAICompatibleProvider(host, { name: "lmstudio", baseUrl: "http://x/v1" });
    const events = await collect(
      p.complete({
        model: "qwen3-14b",
        messages: [{ role: "user", content: "who is alice" }],
        tools: [{ name: "read_note", description: "", inputSchema: {} }],
      }),
    );
    expect(events.some((e) => e.type === "tool_use")).toBe(false);
    const done = events.find((e) => e.type === "done") as { reason: string };
    expect(done.reason).toBe("end_turn");
  });
});
