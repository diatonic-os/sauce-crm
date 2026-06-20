import { describe, expect, it } from "vitest";
import {
  EventLog,
  CellEngine,
  projectCells,
  canonical,
  type HarnessEvent,
} from "../../src/saucebot/harness/L0Substrate";

// Deterministic clock so hashes are stable + replayable in tests.
const clock = () => {
  let t = 1000;
  return () => (t += 1);
};

describe("EventLog — append-only, hash-chained, replayable", () => {
  it("assigns monotonic seq + ids and chains hashes", () => {
    const log = new EventLog(clock());
    const a = log.append({ type: "user_input", actor: "user", payload: { text: "hi" } });
    const b = log.append({ type: "intent_parse", actor: "harness", payload: { ok: true } });
    expect(a.seq).toBe(0);
    expect(b.seq).toBe(1);
    expect(a.id).toBe("evt_0");
    expect(b.parentId).toBe("evt_0");
    expect(a.hash).not.toBe(b.hash);
    expect(log.verifyChain()).toBe(true);
  });

  it("is deterministic — same appends + same clock ⇒ identical hashes (replay)", () => {
    const build = () => {
      const log = new EventLog(clock());
      log.append({ type: "user_input", actor: "user", payload: { text: "hi" } });
      log.append({ type: "plan", actor: "harness", payload: { steps: [1, 2] } });
      return log.all().map((e) => e.hash);
    };
    expect(build()).toEqual(build());
  });

  it("canonical() is key-order independent (byte-stable for caching)", () => {
    expect(canonical({ a: 1, b: 2 })).toBe(canonical({ b: 2, a: 1 }));
  });

  it("since() returns only events after a seq", () => {
    const log = new EventLog(clock());
    log.append({ type: "user_input", actor: "user", payload: {} });
    log.append({ type: "output", actor: "harness", payload: {} });
    expect(log.since(0).map((e) => e.seq)).toEqual([1]);
  });
});

describe("CellEngine — cells mutate only by appended events", () => {
  it("propose adds candidates and moves the cell to resolving", () => {
    const log = new EventLog(clock());
    const eng = new CellEngine(log);
    eng.propose("intent.goal", { value: "ship", confidence: 0.6 }, "harness");
    const c = eng.cell("intent.goal");
    expect(c?.state).toBe("resolving");
    expect(c?.candidates).toHaveLength(1);
  });

  it("collapse resolves to the highest-confidence candidate with provenance", () => {
    const log = new EventLog(clock());
    const eng = new CellEngine(log);
    const e1 = eng.propose("intent.goal", { value: "lo", confidence: 0.3 }, "harness");
    const e2 = eng.propose("intent.goal", { value: "hi", confidence: 0.9 }, "harness");
    const collapse = eng.collapse("intent.goal");
    expect(collapse?.type).toBe("cell_collapse");
    const c = eng.cell("intent.goal");
    expect(c?.state).toBe("resolved");
    expect(c?.resolvedValue).toBe("hi");
    expect(c?.provenance).toEqual(expect.arrayContaining([e1.id, e2.id]));
  });

  it("flags a contradiction when two candidates conflict at high confidence", () => {
    const log = new EventLog(clock());
    const eng = new CellEngine(log);
    eng.propose("intent.goal", { value: "A", confidence: 0.8 }, "src1");
    eng.propose("intent.goal", { value: "B", confidence: 0.85 }, "src2");
    const out = eng.collapse("intent.goal");
    expect(out?.type).toBe("contradiction");
    expect(eng.cell("intent.goal")?.state).toBe("contradicted");
  });

  it("never resolves a cell without a provenance event (invariant)", () => {
    const log = new EventLog(clock());
    const eng = new CellEngine(log);
    expect(eng.collapse("nonexistent")).toBeNull();
    expect(eng.cell("nonexistent")).toBeUndefined();
  });

  it("projectCells is a pure reduction over the event log (replayable state)", () => {
    const log = new EventLog(clock());
    const eng = new CellEngine(log);
    eng.propose("c1", { value: "x", confidence: 0.7 }, "a");
    eng.collapse("c1");
    const replayed = projectCells(log.all() as HarnessEvent[]);
    expect(replayed.get("c1")?.resolvedValue).toBe("x");
    expect(replayed.get("c1")?.state).toBe("resolved");
  });
});
