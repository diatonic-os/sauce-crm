// OllamaProvider — NDJSON streaming + batch fallback contract.

import { describe, expect, it } from "vitest";
import { OllamaProvider } from "../../src/copilot/OllamaProvider";
import { ProviderHostMock } from "../_stubs/ProviderHostMock";

async function collect<T>(it: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const v of it) out.push(v);
  return out;
}

describe("OllamaProvider — batch path", () => {
  it("emits text + usage + done from a single non-stream response", async () => {
    const host = new ProviderHostMock();
    host.route("/api/chat", {
      status: 200,
      body: JSON.stringify({ message: { content: "hi" }, prompt_eval_count: 3, eval_count: 2 }),
    });
    const p = new OllamaProvider(host, { endpoint: "http://localhost:11434" });
    const events = await collect(p.complete({
      model: "llama3", messages: [{ role: "user", content: "hi" }],
    }));
    expect(events.map((e) => e.type)).toEqual(["text", "usage", "done"]);
  });
});

describe("OllamaProvider — NDJSON streaming", () => {
  function ndjson(lines: unknown[]): string[] {
    const joined = lines.map((l) => JSON.stringify(l)).join("\n") + "\n";
    // Slice across line boundaries to prove the parser buffers correctly.
    const chunks: string[] = [];
    for (let i = 0; i < joined.length; i += 9) chunks.push(joined.slice(i, i + 9));
    return chunks;
  }

  it("emits one text event per NDJSON frame", async () => {
    const host = new ProviderHostMock();
    host.routeStream("/api/chat", {
      status: 200,
      chunks: ndjson([
        { message: { role: "assistant", content: "Hel" }, done: false },
        { message: { role: "assistant", content: "lo" }, done: false },
        { message: { role: "assistant", content: " world" }, done: false },
        { message: { role: "assistant", content: "" }, done: true, prompt_eval_count: 6, eval_count: 4 },
      ]),
    });
    const p = new OllamaProvider(host, { endpoint: "http://localhost:11434" });
    const events = await collect(p.complete({
      model: "llama3", messages: [{ role: "user", content: "hi" }], stream: true,
    }));
    const texts = events.filter((e) => e.type === "text") as Array<{ type: "text"; delta: string }>;
    expect(texts.map((t) => t.delta)).toEqual(["Hel", "lo", " world"]);
    const usage = events.find((e) => e.type === "usage") as { type: "usage"; inputTokens: number; outputTokens: number };
    expect(usage.inputTokens).toBe(6);
    expect(usage.outputTokens).toBe(4);
    const done = events.find((e) => e.type === "done") as { type: "done"; reason: string };
    expect(done.reason).toBe("end_turn");
  });

  it("sets stream:true in the posted body", async () => {
    const host = new ProviderHostMock();
    host.routeStream("/api/chat", {
      status: 200,
      chunks: ndjson([{ message: { content: "x" }, done: true, prompt_eval_count: 1, eval_count: 1 }]),
    });
    const p = new OllamaProvider(host, { endpoint: "http://localhost:11434" });
    await collect(p.complete({ model: "llama3", messages: [{ role: "user", content: "hi" }], stream: true }));
    const req = host.lastRequestTo("/api/chat");
    expect(JSON.parse(req!.body!).stream).toBe(true);
  });

  it("yields done:error on 5xx without throwing", async () => {
    const host = new ProviderHostMock();
    host.routeStream("/api/chat", { status: 500, chunks: ["boom"] });
    const p = new OllamaProvider(host, { endpoint: "http://localhost:11434" });
    const events = await collect(p.complete({
      model: "llama3", messages: [{ role: "user", content: "hi" }], stream: true,
    }));
    expect(events).toHaveLength(1);
    expect((events[0] as { type: "done"; reason: string }).reason).toBe("error");
  });
});
