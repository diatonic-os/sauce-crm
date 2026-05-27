// SauceBotRuntime multi-turn tool-use loop.
// Pins: (1) the runtime feeds tool results back as new messages, (2) the
// max-turn cap fires when a provider keeps emitting tool_use forever.

import { describe, expect, it, vi } from "vitest";
import { SauceBotRuntime, type SauceBotSettings } from "../../src/saucebot/SauceBotRuntime";
import type { ChatMessage, CompletionEvent, CompletionRequest, ISauceBotProvider, ModelDescriptor, ProviderCapabilities } from "../../src/saucebot/ISauceBotProvider";

interface Round {
  events: CompletionEvent[];
}

class ScriptedProvider implements ISauceBotProvider {
  readonly name = "scripted";
  readonly models: ModelDescriptor[] = [];
  public seen: ChatMessage[][] = [];
  private idx = 0;
  constructor(private rounds: Round[] | ((round: number) => Round)) {}
  capabilities(): ProviderCapabilities { return { toolUse: true, streaming: true, vision: false, maxContext: 8000 }; }
  async embed(): Promise<Float32Array> { return new Float32Array(); }
  async *complete(req: CompletionRequest): AsyncIterable<CompletionEvent> {
    this.seen.push(req.messages.map((m) => ({ ...m })));
    const round = typeof this.rounds === "function" ? this.rounds(this.idx) : this.rounds[Math.min(this.idx, this.rounds.length - 1)];
    this.idx++;
    for (const ev of round.events) yield ev;
  }
}

function makeRuntime(provider: ISauceBotProvider) {
  const settings: SauceBotSettings = {
    provider: "anthropic", model: "m", apiKey: "k",
    temperature: 0, maxTokens: 100, systemPrompt: "sys",
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const app = { vault: {}, metadataCache: {} } as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const entities = {} as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const search = {} as any;
  const rt = new SauceBotRuntime(app, entities, search, settings);
  // Stub RAG to avoid touching the real host adapters.
  rt.rag = {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    assemble: async () => ({
      pinned: [], focus: null, graph: [], semantic: [], recentTouches: [],
      addenda: {}, estimatedTokens: 0, trimmed: false, centered: [],
    }),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
  // Force provider() to return our scripted instance.
  rt.provider = () => provider;
  // Register a fake tool.
  rt.toolUse.register({
    id: "echo",
    description: "echo",
    contract: { inputs: [{ name: "msg", type: "string" }], level: "safe" },
    execute: async (args) => ({ echoed: args.msg }),
  });
  return rt;
}

describe("SauceBotRuntime.ask — multi-turn tool loop", () => {
  it("feeds tool result back as a new message and completes on end_turn", async () => {
    const provider = new ScriptedProvider([
      { events: [
        { type: "tool_use", id: "call_1", name: "echo", input: { msg: "hi" } },
        { type: "done", reason: "tool_use" },
      ] },
      { events: [
        { type: "text", delta: "done" },
        { type: "done", reason: "end_turn" },
      ] },
    ]);
    const rt = makeRuntime(provider);
    const events: CompletionEvent[] = [];
    for await (const ev of rt.ask("test")) events.push(ev);

    // Two provider rounds.
    expect(provider.seen.length).toBe(2);
    // Round 2 messages should contain the original user msg + assistant tool_use + tool result.
    const round2 = provider.seen[1];
    const assistant = round2.find((m) => m.role === "assistant");
    expect(assistant).toBeDefined();
    const blocks = assistant!.content as Array<{ type: string; id?: string; name?: string }>;
    expect(blocks.some((b) => b.type === "tool_use" && b.id === "call_1" && b.name === "echo")).toBe(true);
    const toolMsg = round2.find((m) => m.role === "tool");
    expect(toolMsg).toBeDefined();
    expect(toolMsg!.toolCallId).toBe("call_1");
    expect(typeof toolMsg!.content === "string" && (toolMsg!.content as string).includes("echoed")).toBe(true);

    // Consumer saw both the tool_use and the final text + done(end_turn).
    expect(events.some((e) => e.type === "tool_use")).toBe(true);
    expect(events.some((e) => e.type === "text" && e.delta === "done")).toBe(true);
    const last = events[events.length - 1];
    expect(last.type).toBe("done");
    if (last.type === "done") expect(last.reason).toBe("end_turn");
  });

  it("caps at 8 tool turns and yields done(max_tokens) with tool-turn cap error", async () => {
    let calls = 0;
    const provider = new ScriptedProvider(() => {
      const id = `call_${calls++}`;
      return { events: [
        { type: "tool_use", id, name: "echo", input: { msg: id } },
        { type: "done", reason: "tool_use" },
      ] };
    });
    const rt = makeRuntime(provider);
    const events: CompletionEvent[] = [];
    for await (const ev of rt.ask("test")) events.push(ev);

    // Provider called 9 times (turns 0..8 inclusive), then cap fires.
    expect(provider.seen.length).toBe(9);
    const last = events[events.length - 1];
    expect(last.type).toBe("done");
    if (last.type === "done") {
      expect(last.reason).toBe("max_tokens");
      expect(last.error).toBe("tool-turn cap reached");
    }
  });

  it("unknown tool yields a tool result with { error: 'unknown tool' }", async () => {
    const provider = new ScriptedProvider([
      { events: [
        { type: "tool_use", id: "x", name: "no_such_tool", input: {} },
        { type: "done", reason: "tool_use" },
      ] },
      { events: [ { type: "done", reason: "end_turn" } ] },
    ]);
    const rt = makeRuntime(provider);
    const events: CompletionEvent[] = [];
    for await (const ev of rt.ask("test")) events.push(ev);
    const round2 = provider.seen[1];
    const toolMsg = round2.find((m) => m.role === "tool");
    expect(toolMsg).toBeDefined();
    expect((toolMsg!.content as string)).toContain("unknown tool");
  });
});

// Silence unused-import warning for vi.
void vi;
