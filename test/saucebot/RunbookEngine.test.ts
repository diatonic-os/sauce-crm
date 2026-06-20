// ─────────────────────────────────────────────────────────────────────────────
//  RunbookEngine — SAUCEOM_HARNESS_DIRECTIVE @L4_runbooks
//  Test suite (TDD): write tests first, then the implementation.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect, vi } from "vitest";
import {
  RunbookEngine,
  type Runbook,
  type Stage,
  type RunCtx,
  type StageResult,
  type StageRunner,
} from "../../src/saucebot/harness/RunbookEngine";

// ── helpers ──────────────────────────────────────────────────────────────────

/** Build a StageRunner fake that always succeeds, optionally injecting outputs. */
function makeRunner(
  responses: Record<
    string,
    { ok: boolean; recap: string; nextSteps: string[]; outputs?: Record<string, unknown> }
  > = {}
): StageRunner {
  return async (stage: Stage, _ctx: RunCtx) => {
    const override = responses[stage.name];
    if (override) return override;
    return { ok: true, recap: `ran ${stage.name}`, nextSteps: [] };
  };
}

// ═══════════════════════════════════════════════════════════════════════════
//  1. Stages run in order; outputs flow into later stage ctx.vars
// ═══════════════════════════════════════════════════════════════════════════
describe("runRunbook — stage ordering and output propagation", () => {
  it("executes stages in declaration order and merges outputs into ctx.vars", async () => {
    const order: string[] = [];

    const runner: StageRunner = async (stage, ctx) => {
      order.push(stage.name);
      if (stage.name === "A") {
        return { ok: true, recap: "done A", nextSteps: [], outputs: { fromA: 42 } };
      }
      // Stage B can see outputs from A
      return {
        ok: true,
        recap: `done B — saw fromA=${ctx.vars["fromA"]}`,
        nextSteps: [],
        outputs: { fromB: (ctx.vars["fromA"] as number) + 1 },
      };
    };

    const runbooks: Runbook[] = [
      { id: "rb1", stages: [{ name: "A" }, { name: "B" }] },
    ];

    const engine = new RunbookEngine(runbooks, runner);
    const ctx = await engine.runRunbook("rb1");

    expect(order).toEqual(["A", "B"]);
    expect(ctx.vars["fromA"]).toBe(42);
    expect(ctx.vars["fromB"]).toBe(43);
    expect(ctx.stageResults).toHaveLength(2);
    expect(ctx.stageResults[0]?.recap).toBe("done A");
    expect(ctx.stageResults[1]?.recap).toMatch(/saw fromA=42/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//  2. A failing stage halts remaining stages
// ═══════════════════════════════════════════════════════════════════════════
describe("runRunbook — early halt on failure", () => {
  it("stops after first failing stage and does not run later stages", async () => {
    const order: string[] = [];

    const runner: StageRunner = async (stage) => {
      order.push(stage.name);
      if (stage.name === "fail") {
        return { ok: false, recap: "something broke", nextSteps: ["retry"] };
      }
      return { ok: true, recap: `ok ${stage.name}`, nextSteps: [] };
    };

    const runbooks: Runbook[] = [
      { id: "rb2", stages: [{ name: "before" }, { name: "fail" }, { name: "after" }] },
    ];

    const engine = new RunbookEngine(runbooks, runner);
    const ctx = await engine.runRunbook("rb2");

    expect(order).toEqual(["before", "fail"]);           // "after" never runs
    expect(ctx.stageResults).toHaveLength(2);
    expect(ctx.stageResults[1]?.ok).toBe(false);
    expect(ctx.stageResults[1]?.nextSteps).toEqual(["retry"]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//  3. runChain follows a static next id
// ═══════════════════════════════════════════════════════════════════════════
describe("runChain — static next chaining", () => {
  it("runs rb1 then follows next:'rb2' and collects all results", async () => {
    const runner = makeRunner();

    const runbooks: Runbook[] = [
      { id: "rb1", stages: [{ name: "s1" }], next: "rb2" },
      { id: "rb2", stages: [{ name: "s2" }] },   // no next → chain ends
    ];

    const engine = new RunbookEngine(runbooks, runner);
    const ctx = await engine.runChain("rb1");

    const stageNames = ctx.stageResults.map((r) => r.stage);
    expect(stageNames).toEqual(["s1", "s2"]);
    const rbIds = ctx.stageResults.map((r) => r.runbook);
    expect(rbIds).toEqual(["rb1", "rb2"]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//  4. runChain follows a conditional next fn and stops on null
// ═══════════════════════════════════════════════════════════════════════════
describe("runChain — conditional next function", () => {
  it("resolves next via fn using ctx.vars and halts when fn returns null", async () => {
    const runner: StageRunner = async (stage) => {
      if (stage.name === "decide") {
        return { ok: true, recap: "decided", nextSteps: [], outputs: { route: "rb-yes" } };
      }
      return { ok: true, recap: `ran ${stage.name}`, nextSteps: [] };
    };

    const runbooks: Runbook[] = [
      {
        id: "rb-start",
        stages: [{ name: "decide" }],
        next: (ctx: RunCtx) => (ctx.vars["route"] as string | undefined) ?? null,
      },
      {
        id: "rb-yes",
        stages: [{ name: "terminal" }],
        next: () => null,   // explicitly ends chain
      },
    ];

    const engine = new RunbookEngine(runbooks, runner);
    const ctx = await engine.runChain("rb-start");

    const stageNames = ctx.stageResults.map((r) => r.stage);
    expect(stageNames).toEqual(["decide", "terminal"]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//  5. Loop guard caps hops at 20
// ═══════════════════════════════════════════════════════════════════════════
describe("runChain — infinite-loop guard", () => {
  it("throws (or stops) after 20 runbook hops to prevent infinite chains", async () => {
    const runner = makeRunner();

    // A single runbook that always points back to itself
    const runbooks: Runbook[] = [
      { id: "loop", stages: [{ name: "step" }], next: "loop" },
    ];

    const engine = new RunbookEngine(runbooks, runner);
    await expect(engine.runChain("loop")).rejects.toThrow(/loop|hop|limit|max/i);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//  6. initialVars are visible to stages
// ═══════════════════════════════════════════════════════════════════════════
describe("runRunbook — initialVars", () => {
  it("passes initialVars into ctx.vars before the first stage runs", async () => {
    let seenVars: Record<string, unknown> = {};

    const runner: StageRunner = async (_stage, ctx) => {
      seenVars = { ...ctx.vars };
      return { ok: true, recap: "ok", nextSteps: [] };
    };

    const runbooks: Runbook[] = [
      { id: "rb-init", stages: [{ name: "check" }] },
    ];

    const engine = new RunbookEngine(runbooks, runner);
    await engine.runRunbook("rb-init", { seed: "hello" });

    expect(seenVars["seed"]).toBe("hello");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//  7. StageResult carries correct metadata fields
// ═══════════════════════════════════════════════════════════════════════════
describe("StageResult — field correctness", () => {
  it("records runbook id, stage name, ok, recap, nextSteps, outputs on each result", async () => {
    const runner = makeRunner({
      myStage: {
        ok: true,
        recap: "line1\nline2\nline3",
        nextSteps: ["do this", "do that"],
        outputs: { key: "val" },
      },
    });

    const runbooks: Runbook[] = [
      { id: "rb-meta", stages: [{ name: "myStage" }] },
    ];

    const engine = new RunbookEngine(runbooks, runner);
    const ctx = await engine.runRunbook("rb-meta");

    const r = ctx.stageResults[0] as StageResult;
    expect(r.runbook).toBe("rb-meta");
    expect(r.stage).toBe("myStage");
    expect(r.ok).toBe(true);
    expect(r.recap).toBe("line1\nline2\nline3");
    expect(r.nextSteps).toEqual(["do this", "do that"]);
    expect(r.outputs).toEqual({ key: "val" });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//  8. runRunbook throws on unknown id
// ═══════════════════════════════════════════════════════════════════════════
describe("runRunbook — unknown id", () => {
  it("throws when runbook id is not registered", async () => {
    const engine = new RunbookEngine([], makeRunner());
    await expect(engine.runRunbook("nonexistent")).rejects.toThrow(/nonexistent/);
  });
});
