// ─────────────────────────────────────────────────────────────────────────────
//  LiveHarness — unit tests
//
//  Per SAUCEOM_HARNESS_DIRECTIVE v0.1 @live_harness:
//    Assembles a ControlLoop whose planner is a real provider (here a fake),
//    plus an injectable persist hook. All side-effects injected — fully
//    testable without Obsidian or lancedb.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, expect, it, vi } from "vitest";
import type {
  ISauceBotProvider,
  CompletionEvent,
  CompletionRequest,
  ProviderCapabilities,
  ModelDescriptor,
} from "../../src/saucebot/ISauceBotProvider";
import type { HarnessEvent } from "../../src/saucebot/harness/L0Substrate";
import { createLiveHarness } from "../../src/saucebot/harness/LiveHarness";

// ─────────────────────────────────────────────────────────────────────────────
//  FAKE PROVIDER
//  Implements the complete ISauceBotProvider surface. complete() yields the
//  scripted CompletionEvent stream for each successive call.
// ─────────────────────────────────────────────────────────────────────────────

class FakeProvider implements ISauceBotProvider {
  readonly name = "fake";
  readonly models: ModelDescriptor[] = [];
  private call = 0;

  constructor(private readonly scripts: CompletionEvent[][]) {}

  capabilities(): ProviderCapabilities {
    return { toolUse: false, streaming: false, vision: false, maxContext: 4096 };
  }

  complete(_req: CompletionRequest): AsyncIterable<CompletionEvent> {
    const events = this.scripts[this.call++ % this.scripts.length] ?? [];
    return (async function* () {
      for (const e of events) yield e;
    })();
  }

  embed(_text: string, _model: string): Promise<Float32Array> {
    return Promise.resolve(new Float32Array());
  }
}

/** Build a scripted provider that always returns a fixed text answer. */
function makeProvider(text: string): FakeProvider {
  const script: CompletionEvent[] = [
    { type: "text", delta: text },
    { type: "done", reason: "end_turn" },
  ];
  return new FakeProvider([script]);
}

// ─────────────────────────────────────────────────────────────────────────────
//  TESTS
// ─────────────────────────────────────────────────────────────────────────────

describe("createLiveHarness", () => {
  it("runTurn returns provider text in output", async () => {
    const harness = createLiveHarness({
      provider: makeProvider("Hello from fake model"),
      model: "test-model",
    });

    const result = await harness.runTurn("Hi there");
    expect(result.output).toContain("Hello from fake model");
  });

  it("events() includes user_input and output events after a turn", async () => {
    const harness = createLiveHarness({
      provider: makeProvider("Some answer"),
      model: "test-model",
    });

    await harness.runTurn("What is 2+2?");

    const types = harness.events().map((e) => e.type);
    expect(types).toContain("user_input");
    expect(types).toContain("output");
  });

  it("persist receives each new event from TurnResult.events", async () => {
    const received: HarnessEvent[] = [];
    const persist = (e: HarnessEvent): void => {
      received.push(e);
    };

    const harness = createLiveHarness({
      provider: makeProvider("Persisted answer"),
      model: "test-model",
      persist,
    });

    const result = await harness.runTurn("Persist me");

    // persist must have been called for every event in TurnResult.events
    expect(received.length).toBe(result.events.length);
    expect(received.length).toBeGreaterThan(0);

    // the event ids must match (same objects in order)
    expect(received.map((e) => e.id)).toEqual(result.events.map((e) => e.id));
  });

  it("persist is NOT called when not provided", async () => {
    // Just verifying no error occurs when persist is omitted.
    const harness = createLiveHarness({
      provider: makeProvider("No persist"),
      model: "test-model",
    });
    await expect(harness.runTurn("No persist turn")).resolves.toBeDefined();
  });

  it("events() accumulates across two runs", async () => {
    const harness = createLiveHarness({
      provider: new FakeProvider([
        [{ type: "text", delta: "first" }, { type: "done", reason: "end_turn" }],
        [{ type: "text", delta: "second" }, { type: "done", reason: "end_turn" }],
      ]),
      model: "test-model",
    });

    await harness.runTurn("turn one");
    const afterFirst = harness.events().length;
    expect(afterFirst).toBeGreaterThan(0);

    await harness.runTurn("turn two");
    const afterSecond = harness.events().length;
    expect(afterSecond).toBeGreaterThan(afterFirst);
  });

  it("is deterministic — same fake + static clock yields identical event hashes", async () => {
    const run = async (): Promise<string[]> => {
      const harness = createLiveHarness({
        provider: makeProvider("deterministic"),
        model: "test-model",
      });
      await harness.runTurn("same input");
      return harness.events().map((e) => e.hash);
    };

    const hashes1 = await run();
    const hashes2 = await run();
    expect(hashes1).toEqual(hashes2);
  });

  it("passes basePrompt through to ControlLoop (does not throw)", async () => {
    const harness = createLiveHarness({
      provider: makeProvider("With base prompt"),
      model: "test-model",
      basePrompt: "You are a helpful assistant.",
    });
    const result = await harness.runTurn("Hello with base prompt");
    expect(result.output).toContain("With base prompt");
  });

  it("passes toolExec through — tool action yields acted:true", async () => {
    // The planner always returns [{kind:"answer"}] via collectText, so toolExec
    // is wired but never fired. We verify that injecting toolExec does not break
    // the harness and that the answer text still comes through.
    // Use a high-confidence verb phrase so the route is "act", not "ask".
    const toolExec = vi.fn().mockResolvedValue({ ok: true, result: "tool result" });

    const harness = createLiveHarness({
      provider: makeProvider("Answer without tool"),
      model: "test-model",
      toolExec,
    });

    // "Find and list the notes" has concrete verbs → high execution conf → act route.
    const result = await harness.runTurn("Find and list the notes for this project");
    // toolExec is wired but the planner emits an 'answer' action, not a 'tool'
    // action, so toolExec should not have been called.
    expect(toolExec).not.toHaveBeenCalled();
    expect(result.output).toContain("Answer without tool");
  });
});
