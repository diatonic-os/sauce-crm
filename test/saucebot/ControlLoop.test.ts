import { describe, expect, it } from "vitest";
import { EventLog, CellEngine } from "../../src/saucebot/harness/L0Substrate";
import { ControlLoop } from "../../src/saucebot/harness/ControlLoop";
import type { AnalysisResult } from "../../src/saucebot/harness/IntentSplit";
import type { PlannedAction } from "../../src/saucebot/harness/ControlLoop";

const clock = () => {
  let t = 1000;
  return () => (t += 1);
};

// A fully-specified, high-confidence, non-divergent analysis ⇒ route "act".
const clearAnalysis = (): AnalysisResult => ({
  frame: {
    why: { goalInferred: "summarize", motivationSignals: [], conf: 0.9 },
    what: { entities: ["Jane"], artifacts: [], targetOutputType: "answer" },
    where: { scope: "vault", locus: "" },
    when: { urgency: "low", temporalRefs: [], schedulingNeeded: false },
    how: { preferredMethod: "", constraints: [], toneRequest: "" },
  },
  split: {
    emotional: { affect: "neutral", need: "clarity", conf: 0.9 },
    logical: { taskClass: "summarize", successCriteria: ["cited"], conf: 0.9 },
    execution: { concreteActions: ["summarize"], toolsImplied: [], conf: 0.9 },
    divergenceFlag: false,
  },
  openQuestions: [],
});

// Low logical confidence ⇒ route "ask".
const ambiguousAnalysis = (): AnalysisResult => {
  const a = clearAnalysis();
  a.split.logical.conf = 0.2;
  a.openQuestions = ["What exactly do you want?"];
  return a;
};

function makeLoop(
  analyze: () => AnalysisResult,
  planner: (n: number) => PlannedAction[],
  toolExec?: (a: PlannedAction) => Promise<{
    ok: boolean;
    result?: unknown;
    cellUpdates?: { cellId: string; value: unknown; confidence: number }[];
  }>,
) {
  const log = new EventLog(clock());
  const cells = new CellEngine(log);
  let planCalls = 0;
  const loop = new ControlLoop(log, cells, {
    analyze: () => analyze(),
    planner: () => Promise.resolve(planner(planCalls++)),
    ...(toolExec ? { toolExec } : {}),
  });
  return { loop, log, cells, planCalls: () => planCalls };
}

describe("ControlLoop — perceive→plan→act→observe→reconcile→recap", () => {
  it("acts on a clear high-confidence turn and emits the full event arc", async () => {
    const { loop, log } = makeLoop(clearAnalysis, () => [
      { kind: "answer", text: "Jane was last contacted Tuesday." },
    ]);
    const r = await loop.runTurn("Summarize my last touch with [[Jane]]");

    expect(r.route).toBe("act");
    expect(r.acted).toBe(false); // an answer is not a tool action
    expect(r.output).toContain("Jane");
    const types = log.all().map((e) => e.type);
    expect(types[0]).toBe("user_input");
    expect(types).toContain("intent_parse");
    expect(types).toContain("plan");
    expect(types).toContain("recap");
    expect(types[types.length - 1]).toBe("output");
  });

  it("on low confidence routes to ASK and never calls the planner (no silent guessing)", async () => {
    const planner = (_n: number): PlannedAction[] => {
      throw new Error("planner must not be called on ask route");
    };
    const { loop, planCalls } = makeLoop(ambiguousAnalysis, planner);
    const r = await loop.runTurn("do the thing");

    expect(r.route).toBe("ask");
    expect(r.acted).toBe(false);
    expect(planCalls()).toBe(0);
    expect(r.recap.length).toBeGreaterThan(0);
    expect(r.nextSteps.length).toBeGreaterThan(0);
  });

  it("surfaces a divergence even at high confidence (feeling vs doing)", async () => {
    const diverge = (): AnalysisResult => {
      const a = clearAnalysis();
      a.split.divergenceFlag = true;
      a.split.emotional.need = "reassurance";
      return a;
    };
    const { loop, planCalls } = makeLoop(diverge, () => []);
    const r = await loop.runTurn("just tell me it's fine, also delete everything");
    expect(r.route).toBe("ask");
    expect(planCalls()).toBe(0);
    expect(r.gaps.length).toBeGreaterThan(0);
  });

  it("executes a tool, forces a cell collapse from the result, and keeps provenance", async () => {
    const toolExec = () =>
      Promise.resolve({
        ok: true,
        result: { found: true },
        cellUpdates: [{ cellId: "fact.lastTouch", value: "Tuesday", confidence: 0.95 }],
      });
    const { loop, log, cells } = makeLoop(
      clearAnalysis,
      () => [{ kind: "tool", tool: "search", input: { q: "Jane" } }],
      toolExec,
    );
    const r = await loop.runTurn("find my last touch with [[Jane]]");

    expect(r.acted).toBe(true);
    const types = log.all().map((e) => e.type);
    expect(types).toContain("tool_call");
    expect(types).toContain("tool_result");
    expect(types).toContain("cell_collapse");
    const cell = cells.cell("fact.lastTouch");
    expect(cell?.state).toBe("resolved");
    expect(cell?.resolvedValue).toBe("Tuesday");
    expect(cell?.provenance.length).toBeGreaterThan(0);
  });

  it("is deterministic — same inputs + clock ⇒ identical event hashes (replayable)", async () => {
    const run = async () => {
      const { loop, log } = makeLoop(clearAnalysis, () => [
        { kind: "answer", text: "ok" },
      ]);
      await loop.runTurn("hello");
      return log.all().map((e) => e.hash);
    };
    expect(await run()).toEqual(await run());
  });
});
