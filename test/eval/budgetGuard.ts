// Budget safety for the SauceBot provider evals. Three independent stops so a
// runaway loop or a pricing miscalc can never blow the per-platform cap:
//   1. HARD $ CAP   — cumulative estimated spend ≥ cap → trip (no more calls).
//   2. CALL CAP     — belt-and-suspenders max #calls even if cost estimate is 0.
//   3. CIRCUIT BREAKER — N consecutive failures → trip (stop hammering a broken
//      endpoint / runaway error loop).
// Plus a manual HARD-KILL (`kill()`) and an out-of-band KILL FILE the operator
// can `touch` to halt mid-run. Once tripped, every `preflight()` throws.

export interface ModelPrice {
  /** USD per 1M input tokens. */
  inUsdPerMtok: number;
  /** USD per 1M output tokens. */
  outUsdPerMtok: number;
}

export interface BudgetGuardOpts {
  platform: string;
  /** Hard USD cap for this platform. */
  capUsd: number;
  /** Max calls regardless of cost (defense if pricing is wrong/zero). */
  maxCalls?: number;
  /** Consecutive failures that trip the breaker. Default 3. */
  breakerThreshold?: number;
  /** Per-model prices; unknown models use `fallbackPrice`. */
  prices: Record<string, ModelPrice>;
  /** Used when a model id isn't in `prices`. Default assumes a pricey model so
   *  we err toward stopping early. */
  fallbackPrice?: ModelPrice;
  /** If this path exists at preflight, trip immediately (out-of-band kill). */
  killFile?: string;
}

export class BudgetExceededError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = "BudgetExceededError";
  }
}
export class CircuitOpenError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = "CircuitOpenError";
  }
}

const DEFAULT_FALLBACK: ModelPrice = { inUsdPerMtok: 15, outUsdPerMtok: 75 };

export class BudgetGuard {
  private spent = 0;
  private calls = 0;
  private consecutiveFailures = 0;
  private trippedReason: string | null = null;
  private readonly threshold: number;
  private readonly fallback: ModelPrice;

  constructor(private readonly o: BudgetGuardOpts) {
    this.threshold = o.breakerThreshold ?? 3;
    this.fallback = o.fallbackPrice ?? DEFAULT_FALLBACK;
  }

  get spentUsd(): number {
    return this.spent;
  }
  get callCount(): number {
    return this.calls;
  }
  get isTripped(): boolean {
    return this.trippedReason !== null;
  }
  get reason(): string | null {
    return this.trippedReason;
  }

  /** Estimated USD cost of a call with the given token usage. */
  costOf(model: string, inTok: number, outTok: number): number {
    const p = this.o.prices[model] ?? this.fallback;
    return (inTok / 1e6) * p.inUsdPerMtok + (outTok / 1e6) * p.outUsdPerMtok;
  }

  /** MUST be called before every provider request. Throws if any stop is hit. */
  preflight(): void {
    if (this.o.killFile && fileExists(this.o.killFile)) {
      this.trip(`kill-file present: ${this.o.killFile}`);
    }
    if (this.trippedReason) {
      const msg = `[${this.o.platform}] STOP — ${this.trippedReason}`;
      // Budget/cap trips surface as BudgetExceededError; everything else (kill,
      // kill-file, failure streak) as CircuitOpenError.
      throw /budget|cap|max calls/i.test(this.trippedReason)
        ? new BudgetExceededError(msg)
        : new CircuitOpenError(msg);
    }
    if (this.spent >= this.o.capUsd) {
      this.trip(`budget cap $${this.o.capUsd} reached (spent ~$${this.spent.toFixed(4)})`);
      throw new BudgetExceededError(`[${this.o.platform}] ${this.trippedReason}`);
    }
    if (this.o.maxCalls !== undefined && this.calls >= this.o.maxCalls) {
      this.trip(`max calls ${this.o.maxCalls} reached`);
      throw new BudgetExceededError(`[${this.o.platform}] ${this.trippedReason}`);
    }
  }

  /** MUST be called after every request with measured usage + outcome.
   *  Updates spend and the circuit breaker; may trip for the NEXT preflight. */
  record(model: string, inTok: number, outTok: number, ok: boolean): void {
    this.calls++;
    this.spent += this.costOf(model, inTok, outTok);
    if (ok) {
      this.consecutiveFailures = 0;
    } else {
      this.consecutiveFailures++;
      if (this.consecutiveFailures >= this.threshold) {
        this.trip(`${this.consecutiveFailures} consecutive failures`);
      }
    }
    if (this.spent >= this.o.capUsd) {
      this.trip(`budget cap $${this.o.capUsd} reached (spent ~$${this.spent.toFixed(4)})`);
    }
  }

  /** Manual hard-kill — stops all further calls immediately. */
  kill(reason = "manual hard-kill"): void {
    this.trip(reason);
  }

  status(): {
    platform: string;
    spentUsd: number;
    capUsd: number;
    calls: number;
    tripped: boolean;
    reason: string | null;
  } {
    return {
      platform: this.o.platform,
      spentUsd: Number(this.spent.toFixed(4)),
      capUsd: this.o.capUsd,
      calls: this.calls,
      tripped: this.isTripped,
      reason: this.trippedReason,
    };
  }

  private trip(reason: string): void {
    if (!this.trippedReason) this.trippedReason = reason;
  }
}

function fileExists(p: string): boolean {
  const req =
    (globalThis as unknown as { require?: NodeRequire }).require ??
    (typeof require !== "undefined" ? require : undefined);
  if (typeof req !== "function") return false;
  try {
    return (req("fs") as typeof import("fs")).existsSync(p);
  } catch {
    return false;
  }
}

// ── Cheap-model price tables ($ per 1M tokens) — pick the cheapest tier so the
//    $10/platform cap gives thousands of small eval calls of headroom. ───────
export const ANTHROPIC_PRICES: Record<string, ModelPrice> = {
  "claude-haiku-4-5": { inUsdPerMtok: 1, outUsdPerMtok: 5 },
  "claude-3-5-haiku-latest": { inUsdPerMtok: 0.8, outUsdPerMtok: 4 },
};
export const OPENAI_PRICES: Record<string, ModelPrice> = {
  "gpt-4o-mini": { inUsdPerMtok: 0.15, outUsdPerMtok: 0.6 },
  "gpt-5-mini": { inUsdPerMtok: 0.25, outUsdPerMtok: 2 },
  "gpt-5-nano": { inUsdPerMtok: 0.05, outUsdPerMtok: 0.4 },
};
export const LOCAL_PRICES: Record<string, ModelPrice> = {}; // LM Studio = free
