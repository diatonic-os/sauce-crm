import { describe, expect, it } from "vitest";
import type {
  ISauceBotProvider,
  CompletionEvent,
  CompletionRequest,
  ProviderCapabilities,
  ModelDescriptor,
} from "../../src/saucebot/ISauceBotProvider";
import {
  collectCompletion,
  collectText,
  runVerified,
  harnessSupportsStructuredOutput,
} from "../../src/saucebot/harness/ProviderHarness";

/** Scriptable provider: each complete() call emits the next event list. Proves
 *  the harness only depends on the unified ISauceBotProvider surface, so it runs
 *  identically over any real provider (LM Studio, OpenAI, Anthropic, …). */
class FakeProvider implements ISauceBotProvider {
  readonly name = "fake";
  readonly models: ModelDescriptor[] = [];
  private call = 0;
  constructor(private scripts: CompletionEvent[][]) {}
  capabilities(): ProviderCapabilities {
    return { toolUse: true, streaming: true, vision: false, maxContext: 8192 };
  }
  complete(_req: CompletionRequest): AsyncIterable<CompletionEvent> {
    const events = this.scripts[this.call++ % this.scripts.length]!;
    return (async function* () {
      for (const e of events) yield e;
    })();
  }
  embed(): Promise<Float32Array> {
    return Promise.resolve(new Float32Array());
  }
}

const req: CompletionRequest = { model: "m", messages: [] };

describe("collectCompletion", () => {
  it("concatenates text, keeps reasoning separate, captures usage + tools", async () => {
    const p = new FakeProvider([
      [
        { type: "reasoning", delta: "let me think " },
        { type: "text", delta: "Hello " },
        { type: "text", delta: "world" },
        { type: "tool_use", id: "t1", name: "search", input: { q: "x" } },
        { type: "usage", inputTokens: 10, outputTokens: 5 },
        { type: "done", reason: "end_turn" },
      ],
    ]);
    const r = await collectCompletion(p, req);
    expect(r.text).toBe("Hello world");
    expect(r.reasoning).toBe("let me think ");
    expect(r.toolUses).toEqual([{ id: "t1", name: "search", input: { q: "x" } }]);
    expect(r.inputTokens).toBe(10);
    expect(r.outputTokens).toBe(5);
    expect(r.doneReason).toBe("end_turn");
  });

  it("surfaces an error done reason", async () => {
    const p = new FakeProvider([
      [{ type: "done", reason: "error", error: "boom" }],
    ]);
    const r = await collectCompletion(p, req);
    expect(r.doneReason).toBe("error");
    expect(r.error).toBe("boom");
  });
});

describe("collectText", () => {
  it("returns just the assembled answer text", async () => {
    const p = new FakeProvider([
      [
        { type: "text", delta: "answer" },
        { type: "done", reason: "stop" },
      ],
    ]);
    expect(await collectText(p, req)).toBe("answer");
  });
});

describe("runVerified — verify stage over any provider", () => {
  it("self-consistency votes across N provider samples", async () => {
    const mk = (s: string): CompletionEvent[] => [
      { type: "text", delta: s },
      { type: "done", reason: "stop" },
    ];
    const p = new FakeProvider([mk("A"), mk("B"), mk("A")]);
    const r = await runVerified(p, req, { samples: 3 });
    expect(r.value).toBe("A");
    expect(r.votes).toBe(2);
  });

  it("applies critique-revise to the voted winner", async () => {
    const mk = (s: string): CompletionEvent[] => [
      { type: "text", delta: s },
      { type: "done", reason: "stop" },
    ];
    const p = new FakeProvider([mk("draft"), mk("draft")]);
    const r = await runVerified(p, req, {
      samples: 2,
      critique: (c) => Promise.resolve({ ok: c.endsWith("!"), feedback: "" }),
      revise: (c) => Promise.resolve(c + "!"),
      maxRounds: 1,
    });
    expect(r.value).toBe("draft!");
    expect(r.accepted).toBe(true);
  });
});

describe("harnessSupportsStructuredOutput", () => {
  it("knows which transports support constrained decoding", () => {
    expect(harnessSupportsStructuredOutput("openai-compat")).toBe(true);
    expect(harnessSupportsStructuredOutput("lmstudio-sdk")).toBe(true);
    expect(harnessSupportsStructuredOutput("anthropic")).toBe(true);
    expect(harnessSupportsStructuredOutput("ollama")).toBe(false);
  });
});
