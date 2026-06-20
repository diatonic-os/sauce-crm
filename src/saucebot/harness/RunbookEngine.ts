// ─────────────────────────────────────────────────────────────────────────────
//  RUNBOOK ENGINE — SAUCEOM_HARNESS_DIRECTIVE @L4_runbooks
// ─────────────────────────────────────────────────────────────────────────────
//
//  Implements the deterministic runbook execution spine described in the
//  directive's L4 layer.  A Runbook is an ordered list of Stages; the engine
//  drives each stage through an injected StageRunner so the module is fully
//  unit-testable with fakes (no Obsidian, no LanceDB, no live ControlLoop).
//
//  Chaining contract
//  ─────────────────
//  • runRunbook  — execute one runbook's stages in order; stop on first failure.
//  • runChain    — follow the `next` pointer (static string or conditional fn)
//                  after each runbook until next resolves to null/undefined or
//                  the hop counter exceeds MAX_CHAIN_HOPS (20).
//
//  Output propagation
//  ──────────────────
//  Each stage's `outputs` map is shallow-merged into ctx.vars so later stages
//  (and later runbooks in a chain) can read values produced upstream.  The
//  merge is non-destructive: the runner owns what it writes; older keys persist
//  unless explicitly overwritten.

/** A single step inside a Runbook. */
export interface Stage {
  /** Human-readable name; used as a correlation key in StageResult. */
  name: string;
  /** If set, the engine can pass this hint to the runner for intent gating. */
  intentRequired?: string;
  /** If set, the engine can pass this list to the runner for tool gating. */
  toolsAllowed?: string[];
  /**
   * Optional id of a *different* stage to transition to on completion.
   * Informational — the engine itself always executes stages in array order;
   * runners may use this for UI hints or conditional branching at a higher layer.
   */
  onComplete?: string;
}

/** The accumulated context that flows through all stages (and all runbooks in
 *  a chain).  Both `vars` and `stageResults` are mutated in place as stages
 *  execute so that later stages always see a fully up-to-date snapshot. */
export interface RunCtx {
  /** Flat key-value store; stage outputs are merged here after each stage. */
  vars: Record<string, unknown>;
  /** Ordered log of every stage that ran (including failures). */
  stageResults: StageResult[];
}

/** The result record produced for every stage that ran. */
export interface StageResult {
  /** Id of the runbook that owned this stage. */
  runbook: string;
  /** Name of the stage. */
  stage: string;
  /** Whether the stage completed successfully. */
  ok: boolean;
  /** ≤3-line human-readable summary returned verbatim from the runner. */
  recap: string;
  /** Ranked list of follow-on actions (pass-through from runner). */
  nextSteps: string[];
  /** Arbitrary key-value pairs the runner wants to publish into ctx.vars. */
  outputs?: Record<string, unknown>;
}

/** Injected executor: given a Stage and the current RunCtx, produce a result.
 *  All side-effects live here — the engine itself is pure coordination. */
export type StageRunner = (
  stage: Stage,
  ctx: RunCtx
) => Promise<{
  ok: boolean;
  recap: string;
  nextSteps: string[];
  outputs?: Record<string, unknown>;
}>;

/** A runbook: an ordered list of stages plus an optional chain pointer. */
export interface Runbook {
  /** Unique identifier used to look up and chain runbooks. */
  id: string;
  /** Stages executed in array order. */
  stages: Stage[];
  /**
   * After this runbook completes (all stages ok), resolve the next runbook id.
   * • string  — always go to that runbook.
   * • fn      — call with the current ctx; return id string or null to end chain.
   * • absent  — chain ends here.
   */
  next?: string | ((ctx: RunCtx) => string | null);
}

/** Safety cap for runChain: prevents runbooks that form a cycle from spinning
 *  forever.  At hop 21 the engine throws. */
const MAX_CHAIN_HOPS = 20;

// ═══════════════════════════════════════════════════════════════════════════
//  RunbookEngine
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Drives runbook execution over an injected StageRunner.
 *
 * Construct once with the full runbook registry and a runner implementation,
 * then call `runRunbook` or `runChain` any number of times.  Each call
 * receives its own isolated RunCtx (optionally seeded with initialVars).
 */
export class RunbookEngine {
  private readonly _index: Map<string, Runbook>;
  private readonly _run: StageRunner;

  constructor(runbooks: Runbook[], run: StageRunner) {
    this._index = new Map(runbooks.map((rb) => [rb.id, rb]));
    this._run = run;
  }

  // ── public API ────────────────────────────────────────────────────────────

  /**
   * Execute a single runbook's stages in order.
   *
   * - initialVars are shallow-copied into ctx.vars before the first stage.
   * - Each stage's `outputs` are merged into ctx.vars immediately after the
   *   stage returns, so subsequent stages see all accumulated values.
   * - If any stage returns `ok: false`, the engine records the result and
   *   returns immediately — remaining stages do NOT run.
   *
   * @throws Error if `id` is not registered.
   */
  async runRunbook(
    id: string,
    initialVars: Record<string, unknown> = {}
  ): Promise<RunCtx> {
    const rb = this._requireRunbook(id);
    const ctx: RunCtx = {
      vars: { ...initialVars },
      stageResults: [],
    };
    await this._executeRunbook(rb, ctx);
    return ctx;
  }

  /**
   * Execute a chain of runbooks, following each runbook's `next` pointer
   * until the chain ends or the hop limit is reached.
   *
   * All runbooks in the chain share a single RunCtx so vars and results
   * accumulate across the whole chain.
   *
   * Chain termination conditions:
   * 1. `next` is absent / undefined.
   * 2. `next` fn returns null.
   * 3. A stage inside any runbook returns `ok: false` (early-halt propagates).
   * 4. Hop counter exceeds MAX_CHAIN_HOPS — throws to surface infinite loops.
   *
   * @throws Error if any runbook id (including those resolved via `next`) is
   *         not registered, or if the hop limit is exceeded.
   */
  async runChain(
    startId: string,
    initialVars: Record<string, unknown> = {}
  ): Promise<RunCtx> {
    const ctx: RunCtx = {
      vars: { ...initialVars },
      stageResults: [],
    };

    let currentId: string | null = startId;
    let hops = 0;

    while (currentId !== null) {
      if (hops >= MAX_CHAIN_HOPS) {
        throw new Error(
          `RunbookEngine: chain hop limit (${MAX_CHAIN_HOPS}) exceeded — ` +
            `possible infinite loop detected at runbook "${currentId}".`
        );
      }

      const rb = this._requireRunbook(currentId);
      const halted = await this._executeRunbook(rb, ctx);

      hops += 1;

      // If a stage failed, honour the early-halt and do not follow next.
      if (halted) break;

      // Resolve next runbook id.
      if (rb.next === undefined || rb.next === null) {
        break;
      } else if (typeof rb.next === "string") {
        currentId = rb.next;
      } else {
        currentId = rb.next(ctx);
      }
    }

    return ctx;
  }

  // ── private helpers ───────────────────────────────────────────────────────

  /**
   * Execute one runbook's stages against an existing ctx (mutates in place).
   * Returns true if execution was halted early due to a stage failure,
   * false if all stages completed successfully.
   */
  private async _executeRunbook(rb: Runbook, ctx: RunCtx): Promise<boolean> {
    for (const stage of rb.stages) {
      const result = await this._run(stage, ctx);

      const sr: StageResult = {
        runbook: rb.id,
        stage: stage.name,
        ok: result.ok,
        recap: result.recap,
        nextSteps: result.nextSteps,
        ...(result.outputs !== undefined ? { outputs: result.outputs } : {}),
      };

      ctx.stageResults.push(sr);

      // Merge outputs into vars immediately so the next stage sees them.
      if (result.outputs !== undefined) {
        Object.assign(ctx.vars, result.outputs);
      }

      // Early halt — do not run subsequent stages.
      if (!result.ok) return true;
    }
    return false;
  }

  /** Look up a runbook by id or throw a descriptive error. */
  private _requireRunbook(id: string): Runbook {
    const rb = this._index.get(id);
    if (rb === undefined) {
      throw new Error(
        `RunbookEngine: runbook "${id}" is not registered. ` +
          `Available ids: [${[...this._index.keys()].join(", ")}]`
      );
    }
    return rb;
  }
}
