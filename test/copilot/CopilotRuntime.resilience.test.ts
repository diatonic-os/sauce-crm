// SauceBotRuntime resilience wrapper (completeResilient via ask()).
// Pins: (1) an unreachable pingable provider short-circuits to done:error
// without ever calling complete(); (2) a transient error with nothing streamed
// is retried and can then succeed; (3) status + reasoning events flow through.

import { describe, expect, it } from "vitest";
import {
  SauceBotRuntime,
  type SauceBotSettings,
} from "../../src/saucebot/SauceBotRuntime";
import type {
  CompletionEvent,
  CompletionRequest,
  ISauceBotProvider,
  ModelDescriptor,
  ProviderCapabilities,
} from "../../src/saucebot/ISauceBotProvider";

class FakeProvider implements ISauceBotProvider {
  readonly name = "lmstudio";
  readonly models: ModelDescriptor[] = [];
  endpoint = "http://localhost:1234/v1";
  completeCalls = 0;
  pingCalls = 0;
  constructor(
    private opts: {
      pings?: Array<{ ok: boolean; error?: string }>;
      rounds?: CompletionEvent[][];
    },
  ) {}
  capabilities(): ProviderCapabilities {
    return { toolUse: false, streaming: true, vision: false, maxContext: 8000 };
  }
  async embed(): Promise<Float32Array> {
    return new Float32Array();
  }
  async ping(): Promise<{ ok: boolean; error?: string }> {
    const p =
      this.opts.pings?.[
        Math.min(this.pingCalls, (this.opts.pings.length ?? 1) - 1)
      ];
    this.pingCalls++;
    return p ?? { ok: true };
  }
  async *complete(_req: CompletionRequest): AsyncIterable<CompletionEvent> {
    const round = this.opts.rounds?.[
      Math.min(this.completeCalls, (this.opts.rounds.length ?? 1) - 1)
    ] ?? [{ type: "done", reason: "end_turn" }];
    this.completeCalls++;
    for (const ev of round) yield ev;
  }
}

function makeRuntime(provider: ISauceBotProvider, maxRetries = 1) {
  const settings: SauceBotSettings = {
    provider: "lmstudio",
    model: "qwen3.5-9b",
    apiKey: "",
    temperature: 0,
    maxTokens: 100,
    systemPrompt: "sys",
    maxRetries,
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const app = { vault: {}, metadataCache: {} } as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rt = new SauceBotRuntime(app, {} as any, {} as any, settings);
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
  return rt;
}

async function collect(rt: SauceBotRuntime): Promise<CompletionEvent[]> {
  const out: CompletionEvent[] = [];
  for await (const ev of rt.ask("hi")) out.push(ev);
  return out;
}

describe("SauceBotRuntime — resilience / health", () => {
  it("short-circuits to a clear done:error when an unreachable provider's ping fails", async () => {
    const provider = new FakeProvider({
      pings: [{ ok: false, error: "ECONNREFUSED" }],
    });
    const rt = makeRuntime(provider, 0); // no retries
    const events = await collect(rt);
    expect(provider.completeCalls).toBe(0); // never attempted the send
    const done = events.find((e) => e.type === "done") as {
      reason: string;
      error?: string;
    };
    expect(done.reason).toBe("error");
    expect(done.error).toContain("unreachable");
    expect(done.error).toContain("http://localhost:1234/v1");
  });

  it("retries a transient ping failure, then succeeds", async () => {
    const provider = new FakeProvider({
      pings: [{ ok: false, error: "fetch failed" }, { ok: true }],
      rounds: [
        [
          { type: "text", delta: "PONG" },
          { type: "done", reason: "end_turn" },
        ],
      ],
    });
    const rt = makeRuntime(provider, 2);
    const events = await collect(rt);
    expect(provider.pingCalls).toBe(2);
    expect(
      events.some((e) => e.type === "status" && e.state === "retrying"),
    ).toBe(true);
    expect(events.some((e) => e.type === "text" && e.delta === "PONG")).toBe(
      true,
    );
    const last = events[events.length - 1];
    expect(last.type === "done" && last.reason).toBe("end_turn");
  });

  it("emits connecting/loading status and passes reasoning through", async () => {
    const provider = new FakeProvider({
      pings: [{ ok: true }],
      rounds: [
        [
          { type: "reasoning", delta: "thinking" },
          { type: "text", delta: "answer" },
          { type: "done", reason: "end_turn" },
        ],
      ],
    });
    const rt = makeRuntime(provider);
    const events = await collect(rt);
    expect(
      events.some((e) => e.type === "status" && e.state === "connecting"),
    ).toBe(true);
    expect(
      events.some((e) => e.type === "status" && e.state === "loading"),
    ).toBe(true);
    expect(
      events.some((e) => e.type === "reasoning" && e.delta === "thinking"),
    ).toBe(true);
  });

  it("salvages a reasoning-only turn via a reasoning-extraction pass", async () => {
    const provider = new FakeProvider({
      pings: [{ ok: true }],
      rounds: [
        // Turn 1: model burns its budget thinking, emits NO final text.
        [
          { type: "reasoning", delta: "thinking hard…" },
          { type: "done", reason: "end_turn" },
        ],
        // Extraction call (completeOnce): now it produces the answer.
        [
          { type: "text", delta: "FINAL ANSWER" },
          { type: "done", reason: "end_turn" },
        ],
      ],
    });
    const rt = makeRuntime(provider);
    const events = await collect(rt);
    expect(provider.completeCalls).toBe(2); // main turn + extraction
    expect(
      events.some((e) => e.type === "text" && e.delta === "FINAL ANSWER"),
    ).toBe(true);
  });

  it("falls back to surfacing the reasoning tail when extraction also yields nothing", async () => {
    const provider = new FakeProvider({
      pings: [{ ok: true }],
      rounds: [
        [
          { type: "reasoning", delta: "deep thoughts about ranking" },
          { type: "done", reason: "end_turn" },
        ],
        [{ type: "done", reason: "end_turn" }], // extraction returns no text either
      ],
    });
    const rt = makeRuntime(provider);
    const events = await collect(rt);
    const salvaged = events.find((e) => e.type === "text") as
      | { delta: string }
      | undefined;
    expect(salvaged?.delta).toContain("deep thoughts about ranking");
  });

  it("does NOT retry once text has already streamed (no duplicate output)", async () => {
    const provider = new FakeProvider({
      pings: [{ ok: true }],
      rounds: [
        [
          { type: "text", delta: "partial" },
          { type: "done", reason: "error", error: "socket hang up" },
        ],
      ],
    });
    const rt = makeRuntime(provider, 3);
    const events = await collect(rt);
    expect(provider.completeCalls).toBe(1); // not retried — output already began
    const texts = events.filter((e) => e.type === "text") as Array<{
      delta: string;
    }>;
    expect(texts.map((t) => t.delta)).toEqual(["partial"]);
    const done = events[events.length - 1];
    expect(done.type === "done" && done.reason).toBe("error");
  });
});
