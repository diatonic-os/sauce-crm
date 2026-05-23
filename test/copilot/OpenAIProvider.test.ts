// OpenAIProvider — SSE streaming + batch fallback contract.

import { describe, expect, it } from "vitest";
import { OpenAIProvider } from "../../src/copilot/OpenAIProvider";
import { ProviderHostMock } from "../_stubs/ProviderHostMock";

async function collect<T>(it: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const v of it) out.push(v);
  return out;
}

describe("OpenAIProvider — batch path", () => {
  it("emits text + usage + done from a single non-stream response", async () => {
    const host = new ProviderHostMock();
    host.route("/chat/completions", {
      status: 200,
      body: JSON.stringify({
        choices: [{ message: { content: "hi there" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 4, completion_tokens: 2 },
      }),
    });
    const p = new OpenAIProvider(host, async () => "sk-test");
    const events = await collect(p.complete({
      model: "gpt-4o-mini", messages: [{ role: "user", content: "hi" }],
    }));
    expect(events.map((e) => e.type)).toEqual(["text", "usage", "done"]);
  });
});

describe("OpenAIProvider — SSE streaming", () => {
  function frames(): string[] {
    const lines = [
      `data: ${JSON.stringify({ choices: [{ delta: { role: "assistant" }, finish_reason: null }] })}\n\n`,
      `data: ${JSON.stringify({ choices: [{ delta: { content: "Foo" }, finish_reason: null }] })}\n\n`,
      `data: ${JSON.stringify({ choices: [{ delta: { content: " bar" }, finish_reason: null }] })}\n\n`,
      `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 2, completion_tokens: 3 } })}\n\n`,
      `data: [DONE]\n\n`,
    ];
    return [lines.join("")];
  }

  it("yields token-by-token deltas", async () => {
    const host = new ProviderHostMock();
    host.routeStream("/chat/completions", { status: 200, chunks: frames() });
    const p = new OpenAIProvider(host, async () => "sk-test");
    const events = await collect(p.complete({
      model: "gpt-4o-mini", messages: [{ role: "user", content: "hi" }], stream: true,
    }));
    const texts = events.filter((e) => e.type === "text") as Array<{ type: "text"; delta: string }>;
    expect(texts.map((t) => t.delta)).toEqual(["Foo", " bar"]);
    const done = events.find((e) => e.type === "done") as { type: "done"; reason: string };
    expect(done.reason).toBe("end_turn");
  });

  it("sets stream:true in the posted body", async () => {
    const host = new ProviderHostMock();
    host.routeStream("/chat/completions", { status: 200, chunks: frames() });
    const p = new OpenAIProvider(host, async () => "sk-test");
    await collect(p.complete({
      model: "gpt-4o-mini", messages: [{ role: "user", content: "hi" }], stream: true,
    }));
    const req = host.lastRequestTo("/chat/completions");
    expect(JSON.parse(req!.body!).stream).toBe(true);
  });

  it("surfaces 4xx as done:error without throwing", async () => {
    const host = new ProviderHostMock();
    host.routeStream("/chat/completions", { status: 401, chunks: [JSON.stringify({ error: "bad key" })] });
    const p = new OpenAIProvider(host, async () => "sk-test");
    const events = await collect(p.complete({
      model: "gpt-4o-mini", messages: [{ role: "user", content: "hi" }], stream: true,
    }));
    expect(events).toHaveLength(1);
    expect((events[0] as { type: "done"; reason: string }).reason).toBe("error");
  });
});
