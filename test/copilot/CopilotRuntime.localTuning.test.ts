// Local-model multi-turn/tool quality tuning in SauceBotRuntime:
//  1. prose tool-prompt injection (local only)
//  2. malformed tool-call repair re-ask
//  3. empty/truncated-answer self-correction retry
//  4. recency-of-attention ordering gate (local only)
// All gated on a local provider so cloud behavior is provably unchanged.

import { describe, expect, it } from "vitest";
import {
  SauceBotRuntime,
  type SauceBotSettings,
} from "../../src/saucebot/SauceBotRuntime";
import type {
  ChatMessage,
  CompletionEvent,
  CompletionRequest,
  ISauceBotProvider,
  ModelDescriptor,
  ProviderCapabilities,
} from "../../src/saucebot/ISauceBotProvider";

interface Round {
  events: CompletionEvent[];
}

class ScriptedProvider implements ISauceBotProvider {
  readonly name = "lmstudio";
  readonly models: ModelDescriptor[] = [];
  public seen: CompletionRequest[] = [];
  private idx = 0;
  constructor(private rounds: Round[] | ((round: number) => Round)) {}
  capabilities(): ProviderCapabilities {
    return { toolUse: true, streaming: true, vision: false, maxContext: 8000 };
  }
  async embed(): Promise<Float32Array> {
    return new Float32Array();
  }
  async *complete(req: CompletionRequest): AsyncIterable<CompletionEvent> {
    this.seen.push({ ...req, messages: req.messages.map((m) => ({ ...m })) });
    const round =
      typeof this.rounds === "function"
        ? this.rounds(this.idx)
        : this.rounds[Math.min(this.idx, this.rounds.length - 1)];
    this.idx++;
    for (const ev of round.events) yield ev;
  }
}

function makeRuntime(
  provider: ISauceBotProvider,
  providerId: "lmstudio" | "anthropic" = "lmstudio",
  localTuning?: SauceBotSettings["localTuning"],
) {
  const settings: SauceBotSettings = {
    provider: providerId,
    model: "qwen3-14b",
    apiKey: "k",
    temperature: 0,
    maxTokens: 100,
    systemPrompt: "sys",
    ...(localTuning !== undefined ? { localTuning } : {}),
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const app = { vault: {}, metadataCache: {} } as any;
  const rt = new SauceBotRuntime(
    app,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    {} as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    {} as any,
    settings,
  );
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  rt.rag = {
    assemble: async () => ({
      pinned: [],
      focus: null,
      graph: [],
      semantic: [],
      recentTouches: [],
      addenda: {},
      estimatedTokens: 0,
      trimmed: false,
      centered: [],
    }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
  rt.provider = () => provider;
  rt.toolUse.register({
    id: "echo",
    description: "echo a message back",
    contract: { inputs: [{ name: "msg", type: "string", required: true }], level: "safe" },
    execute: async (args) => ({ echoed: (args as { msg?: string }).msg }),
  });
  return rt;
}

async function run(
  rt: SauceBotRuntime,
  q = "hi",
  prior: ChatMessage[] = [],
): Promise<CompletionEvent[]> {
  const out: CompletionEvent[] = [];
  for await (const ev of rt.ask(q, undefined, prior)) out.push(ev);
  return out;
}

describe("SauceBotRuntime — local tool prompting", () => {
  it("injects a prose tool prompt for local providers", async () => {
    const provider = new ScriptedProvider([
      { events: [{ type: "text", delta: "done." }, { type: "done", reason: "end_turn" }] },
    ]);
    const rt = makeRuntime(provider, "lmstudio");
    await run(rt);
    const sys = provider.seen[0]!.systemPrompt ?? "";
    expect(sys).toContain("Tools available");
    expect(sys).toContain("echo");
    expect(sys).toContain("ONLY the tool call");
  });

  it("does NOT inject the prose tool prompt for cloud providers", async () => {
    const provider = new ScriptedProvider([
      { events: [{ type: "text", delta: "done." }, { type: "done", reason: "end_turn" }] },
    ]);
    const rt = makeRuntime(provider, "anthropic");
    await run(rt);
    const sys = provider.seen[0]!.systemPrompt ?? "";
    expect(sys).not.toContain("## Tools available");
  });
});

describe("SauceBotRuntime — malformed tool-call repair", () => {
  it("re-asks once to repair {_raw} args, then dispatches the repaired call", async () => {
    const provider = new ScriptedProvider([
      // Turn 1: a malformed tool call (provider sentinel).
      {
        events: [
          { type: "tool_use", id: "c1", name: "echo", input: { _raw: "msg: hi" } },
          { type: "done", reason: "tool_use" },
        ],
      },
      // Turn 2: terminal.
      { events: [{ type: "text", delta: "ok." }, { type: "done", reason: "end_turn" }] },
    ]);
    const rt = makeRuntime(provider, "lmstudio");
    // The repair pass goes through completeOnce → provider.complete; stub it to
    // return valid JSON so we can assert the tool got repaired args.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (rt as any).completeOnce = async () => '{"msg":"hi"}';
    await run(rt);
    // Round 2 must carry a tool result echoing the repaired msg.
    const round2 = provider.seen[1]!.messages;
    const toolMsg = round2.find((m: ChatMessage) => m.role === "tool");
    expect(toolMsg).toBeDefined();
    expect(toolMsg!.content as string).toContain("hi");
  });
});

describe("SauceBotRuntime — empty/truncated answer self-correction", () => {
  it("retries once when a local turn ends truncated, emitting the remainder", async () => {
    const provider = new ScriptedProvider([
      {
        events: [
          { type: "text", delta: "Alice works at Acme and she is the ranking" },
          { type: "done", reason: "end_turn" },
        ],
      },
    ]);
    const rt = makeRuntime(provider, "lmstudio");
    // Self-correction routes through completeOnce; return the full answer.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (rt as any).completeOnce = async () =>
      "Alice works at Acme and she is the ranking lead.";
    const events = await run(rt, "who is alice");
    const texts = events.filter((e) => e.type === "text") as Array<{ delta: string }>;
    const joined = texts.map((t) => t.delta).join("");
    expect(joined).toContain("ranking lead.");
    // No duplication of the streamed prefix.
    expect(joined.indexOf("Alice works at Acme")).toBe(joined.lastIndexOf("Alice works at Acme"));
  });

  it("does NOT self-correct a complete answer", async () => {
    const provider = new ScriptedProvider([
      { events: [{ type: "text", delta: "Alice is the ranking lead at Acme." }, { type: "done", reason: "end_turn" }] },
    ]);
    const rt = makeRuntime(provider, "lmstudio");
    let retried = false;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (rt as any).completeOnce = async () => {
      retried = true;
      return "should not be called";
    };
    await run(rt, "who is alice");
    expect(retried).toBe(false);
  });

  it("does NOT self-correct for cloud providers", async () => {
    const provider = new ScriptedProvider([
      { events: [{ type: "text", delta: "truncated answer that keeps going on and on without end" }, { type: "done", reason: "end_turn" }] },
    ]);
    const rt = makeRuntime(provider, "anthropic");
    let retried = false;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (rt as any).completeOnce = async () => {
      retried = true;
      return "x";
    };
    await run(rt, "q");
    expect(retried).toBe(false);
  });
});

describe("SauceBotRuntime — multi-turn compaction", () => {
  it("summarizes older turns when prior history exceeds the budget, keeping the last turn verbatim", async () => {
    const provider = new ScriptedProvider([
      { events: [{ type: "text", delta: "ok." }, { type: "done", reason: "end_turn" }] },
    ]);
    const rt = makeRuntime(provider, "lmstudio", {
      historyTokenBudget: 50, // tiny so any real history trips it
    });
    // Stub the summarizer (completeOnce) deterministically.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (rt as any).completeOnce = async () => "- earlier: discussed Acme";
    const big = "x".repeat(2000);
    const prior: ChatMessage[] = [
      { role: "user", content: `q1 ${big}` },
      { role: "assistant", content: `a1 ${big}` },
      // Most recent turn (last user+assistant pair) is kept verbatim.
      { role: "user", content: "q2 latest question" },
      { role: "assistant", content: "the most recent answer verbatim" },
    ];
    await run(rt, "follow-up", prior);
    const msgs = provider.seen[0]!.messages;
    const joined = JSON.stringify(msgs);
    // Older turns collapsed into a summary memo.
    expect(joined).toContain("Earlier conversation summary");
    expect(joined).toContain("discussed Acme");
    // Most recent turn kept verbatim.
    expect(joined).toContain("q2 latest question");
    expect(joined).toContain("the most recent answer verbatim");
    // Older bulk content dropped (the 2000-char blob did not survive).
    expect(joined).not.toContain(big);
  });

  it("leaves small prior history untouched", async () => {
    const provider = new ScriptedProvider([
      { events: [{ type: "text", delta: "ok." }, { type: "done", reason: "end_turn" }] },
    ]);
    const rt = makeRuntime(provider, "lmstudio");
    let summarized = false;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (rt as any).completeOnce = async () => {
      summarized = true;
      return "summary";
    };
    const prior: ChatMessage[] = [
      { role: "user", content: "q1" },
      { role: "assistant", content: "a1" },
    ];
    await run(rt, "q2", prior);
    expect(summarized).toBe(false);
    const joined = JSON.stringify(provider.seen[0]!.messages);
    expect(joined).toContain("q1");
  });
});

describe("SauceBotRuntime — recency-of-attention ordering", () => {
  // For local models the most-relevant grounded fact should appear LAST in the
  // inlined context (tail-weighting). For cloud it stays best-first.
  function rtWithDigests(providerId: "lmstudio" | "anthropic") {
    const provider = new ScriptedProvider([
      { events: [{ type: "done", reason: "end_turn" }] },
    ]);
    const rt = makeRuntime(provider, providerId, {});
    // Disable distillation so the deterministic digest section (ordered) runs.
    rt.updateSettings({ distill: { enabled: false } });
    // Stub crystal warmup + per-path digest so no vault is needed.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (rt as any).ensureCrystal = async () => ({ dirty: false });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (rt as any).digestFor = async (path: string) => ({ digest: `DIGEST_${path}`, fresh: false });
    return rt;
  }

  it("places the most-relevant digest LAST for local providers", async () => {
    const rt = rtWithDigests("lmstudio");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const out: string = await (rt as any).inlineEntityContent(["best.md", "second.md", "third.md"], "q");
    expect(out.indexOf("DIGEST_best.md")).toBeGreaterThan(out.indexOf("DIGEST_third.md"));
  });

  it("keeps best-first ordering for cloud providers", async () => {
    const rt = rtWithDigests("anthropic");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const out: string = await (rt as any).inlineEntityContent(["best.md", "second.md", "third.md"], "q");
    expect(out.indexOf("DIGEST_best.md")).toBeLessThan(out.indexOf("DIGEST_third.md"));
  });
});

describe("SauceBotRuntime — self-context-filtering of tool results", () => {
  it("distills an oversized tool result before the next turn", async () => {
    const provider = new ScriptedProvider([
      {
        events: [
          { type: "tool_use", id: "c1", name: "echo", input: { msg: "go" } },
          { type: "done", reason: "tool_use" },
        ],
      },
      { events: [{ type: "text", delta: "done." }, { type: "done", reason: "end_turn" }] },
    ]);
    const rt = makeRuntime(provider, "lmstudio");
    // Make the tool produce a huge result so it exceeds the filter threshold.
    rt.toolUse.unregister("echo");
    const huge = "noise ".repeat(2000);
    rt.toolUse.register({
      id: "echo",
      description: "echo",
      contract: { inputs: [{ name: "msg", type: "string" }], level: "safe" },
      execute: async () => huge,
    });
    // Stub the distiller via completeOnce-backed distill path: force the
    // distill seam to a tiny TOON by stubbing the private distiller's fn.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (rt as any).distillOnce = async () => "query: q\nsources[0]:";
    await run(rt);
    const round2 = provider.seen[1]!.messages;
    const toolMsg = round2.find((m: ChatMessage) => m.role === "tool");
    expect(toolMsg).toBeDefined();
    // Compacted: the huge raw payload must be gone, replaced by the marker.
    expect((toolMsg!.content as string).length).toBeLessThan(huge.length);
    expect(toolMsg!.content as string).toContain("distilled to relevant facts");
  });
});
