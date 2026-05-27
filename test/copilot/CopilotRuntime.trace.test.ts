// T8 — copilot query is fingerprinted/traced via the injected provenance sink.
import { describe, expect, it } from "vitest";
import { SauceBotRuntime, type SauceBotSettings } from "../../src/saucebot/SauceBotRuntime";

function rt(): SauceBotRuntime {
  const settings: SauceBotSettings = {
    provider: "lmstudio", model: "m", apiKey: "", temperature: 0.3, maxTokens: 100, systemPrompt: "base",
  };
  return new SauceBotRuntime({ vault: {}, metadataCache: {} } as never, {} as never, {} as never, settings);
}

describe("SauceBotRuntime.recordQuery (T8)", () => {
  it("records a query trace through the sink", async () => {
    const calls: { op: string; subject: string; kind: string; content: string }[] = [];
    const r = rt();
    r.setTraceSink({ async record(op, subject, kind, content) { calls.push({ op, subject, kind, content }); return { fp: "x" }; } });

    await r.recordQuery("who knows Bob?");
    expect(calls).toEqual([{ op: "query", subject: "copilot", kind: "query", content: "who knows Bob?" }]);
  });

  it("is a no-op (no throw) when no sink is set", async () => {
    await expect(rt().recordQuery("anything")).resolves.toBeUndefined();
  });

  it("swallows sink errors (tracing is best-effort)", async () => {
    const r = rt();
    r.setTraceSink({ async record() { throw new Error("sink down"); } });
    await expect(r.recordQuery("x")).resolves.toBeUndefined();
  });
});
