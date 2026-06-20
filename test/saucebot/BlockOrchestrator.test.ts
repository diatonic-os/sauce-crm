// ─────────────────────────────────────────────────────────────────────────────
//  BlockOrchestrator — test suite (TDD-first)
// ─────────────────────────────────────────────────────────────────────────────
//
//  Tests exercise the six required properties:
//   1. Outputs of block A are visible to dependent block B
//   2. Diamond topology (A → B, C → D) runs in correct dep order
//   3. Retry: a block that throws once succeeds on the 2nd attempt (attempts=2)
//   4. Permanently failing block → ok:false; ONLY its dependents are skipped;
//      independent branches still run
//   5. Cycle detection: runBlocks throws on a cyclic dep graph
//   6. Missing dep detection: runBlocks throws when a dep id doesn't exist

import { describe, it, expect, vi } from "vitest";
import { runBlocks } from "../../src/saucebot/harness/BlockOrchestrator";
import type { Block, Vars } from "../../src/saucebot/harness/BlockOrchestrator";

// ── helpers ──────────────────────────────────────────────────────────────────

/** Build a block that returns a constant output bag. */
function constBlock(id: string, outputs: Vars, deps?: string[]): Block {
  return {
    id,
    deps,
    run: async (_vars: Vars) => outputs,
  };
}

// ─────────────────────────────────────────────────────────────────────────────

describe("BlockOrchestrator", () => {
  // ── 1. Output propagation ──────────────────────────────────────────────────

  it("merges block A outputs into vars visible to dependent block B", async () => {
    const capturedVars: Vars[] = [];

    const blockA = constBlock("A", { x: 42 });
    const blockB: Block = {
      id: "B",
      deps: ["A"],
      run: async (vars: Vars) => {
        capturedVars.push({ ...vars });
        return { y: 99 };
      },
    };

    const result = await runBlocks([blockA, blockB]);

    expect(result.ok).toBe(true);
    expect(capturedVars[0]?.["x"]).toBe(42);
    expect(result.vars["x"]).toBe(42);
    expect(result.vars["y"]).toBe(99);
  });

  // ── 2. Diamond topology ────────────────────────────────────────────────────

  it("handles diamond A→B, A→C, B+C→D in correct order", async () => {
    const order: string[] = [];

    const blockA: Block = {
      id: "A",
      run: async () => { order.push("A"); return { a: 1 }; },
    };
    const blockB: Block = {
      id: "B",
      deps: ["A"],
      run: async (vars: Vars) => {
        order.push("B");
        return { b: (vars["a"] as number) + 10 };
      },
    };
    const blockC: Block = {
      id: "C",
      deps: ["A"],
      run: async (vars: Vars) => {
        order.push("C");
        return { c: (vars["a"] as number) + 20 };
      },
    };
    const blockD: Block = {
      id: "D",
      deps: ["B", "C"],
      run: async (vars: Vars) => {
        order.push("D");
        return { d: (vars["b"] as number) + (vars["c"] as number) };
      },
    };

    const result = await runBlocks([blockA, blockB, blockC, blockD]);

    expect(result.ok).toBe(true);
    // A must come first, D must come last
    expect(order[0]).toBe("A");
    expect(order[order.length - 1]).toBe("D");
    // B and C in the middle (order between them is unspecified)
    expect(new Set(order)).toEqual(new Set(["A", "B", "C", "D"]));
    // computed value: b=11, c=21 → d=32
    expect(result.vars["d"]).toBe(32);
  });

  // ── 3. Retry: succeeds on 2nd attempt ─────────────────────────────────────

  it("retries a failing block and records attempts=2 on 2nd-attempt success", async () => {
    let calls = 0;
    const flakyBlock: Block = {
      id: "flaky",
      retries: 2, // 2 total attempts allowed
      run: async () => {
        calls += 1;
        if (calls === 1) throw new Error("transient");
        return { recovered: true };
      },
    };

    const result = await runBlocks([flakyBlock]);

    expect(result.ok).toBe(true);
    const flaky = result.results.find((r) => r.id === "flaky");
    expect(flaky?.ok).toBe(true);
    expect(flaky?.attempts).toBe(2);
    expect(result.vars["recovered"]).toBe(true);
  });

  // ── 4. Permanent failure: only dependents skipped, independent runs ────────

  it("skips only dependents of a failed block; independent branches still run", async () => {
    const failBlock: Block = {
      id: "fail",
      retries: 1,
      run: async () => { throw new Error("boom"); },
    };
    const dependentBlock: Block = {
      id: "dep",
      deps: ["fail"],
      run: async () => ({ depRan: true }),
    };
    const independentBlock: Block = {
      id: "indep",
      run: async () => ({ indepRan: true }),
    };

    const result = await runBlocks([failBlock, dependentBlock, independentBlock]);

    expect(result.ok).toBe(false);

    const failResult = result.results.find((r) => r.id === "fail");
    expect(failResult?.ok).toBe(false);
    expect(failResult?.error).toBeDefined();

    const depResult = result.results.find((r) => r.id === "dep");
    expect(depResult?.ok).toBe(false);
    expect(depResult?.error).toMatch(/skipped: upstream fail failed/);

    const indepResult = result.results.find((r) => r.id === "indep");
    expect(indepResult?.ok).toBe(true);
    expect(result.vars["indepRan"]).toBe(true);
  });

  // ── 4b. Multi-hop skip propagation ────────────────────────────────────────

  it("propagates skip through a transitive chain A(fail)→B→C, independent D runs", async () => {
    const a: Block = {
      id: "A",
      retries: 1,
      run: async () => { throw new Error("root fail"); },
    };
    const b: Block = { id: "B", deps: ["A"], run: async () => ({ b: 1 }) };
    const c: Block = { id: "C", deps: ["B"], run: async () => ({ c: 1 }) };
    const d: Block = { id: "D", run: async () => ({ d: 1 }) };

    const result = await runBlocks([a, b, c, d]);

    expect(result.ok).toBe(false);
    expect(result.results.find((r) => r.id === "A")?.ok).toBe(false);
    expect(result.results.find((r) => r.id === "B")?.ok).toBe(false);
    expect(result.results.find((r) => r.id === "C")?.ok).toBe(false);
    expect(result.results.find((r) => r.id === "D")?.ok).toBe(true);
    expect(result.vars["d"]).toBe(1);
  });

  // ── 5. Cycle detection ─────────────────────────────────────────────────────

  it("throws on a cyclic dep graph", async () => {
    const a: Block = { id: "A", deps: ["B"], run: async () => ({}) };
    const b: Block = { id: "B", deps: ["A"], run: async () => ({}) };

    await expect(runBlocks([a, b])).rejects.toThrow(/cycle/i);
  });

  // ── 6. Missing dep detection ───────────────────────────────────────────────

  it("throws when a dep id references a non-existent block", async () => {
    const a: Block = { id: "A", deps: ["ghost"], run: async () => ({}) };

    await expect(runBlocks([a])).rejects.toThrow(/ghost/);
  });

  // ── 7. initialVars are passed through ─────────────────────────────────────

  it("passes initialVars into the first block's vars", async () => {
    const captured: Vars[] = [];
    const block: Block = {
      id: "X",
      run: async (vars: Vars) => {
        captured.push({ ...vars });
        return {};
      },
    };

    const result = await runBlocks([block], { seed: "hello" });

    expect(result.ok).toBe(true);
    expect(captured[0]?.["seed"]).toBe("hello");
    expect(result.vars["seed"]).toBe("hello");
  });
});
