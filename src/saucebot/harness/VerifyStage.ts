// ─────────────────────────────────────────────────────────────────────────────
//  VERIFY STAGE — the highest-ROI quality lever for local models
// ─────────────────────────────────────────────────────────────────────────────
//
//  A small local model rarely gets a hard answer right in ONE pass, but it is
//  surprisingly good at (a) agreeing with itself across samples and (b) checking
//  a candidate against criteria. This stage turns both into quality:
//
//    • selfConsistency — sample the generator N times, take the majority answer.
//      Kills one-shot variance; the modal answer is far more reliable than any
//      single draft. (Wang et al. self-consistency, applied to local fleets.)
//
//    • critiqueRevise — generate → critique → revise until a critic accepts or a
//      round budget is hit. Kills unchecked errors; the model fixes its own work.
//
//    • verify — compose the two: vote for a winner, then refine it.
//
//  Everything here is PROVIDER-AGNOSTIC: callers inject async `generate` /
//  `critique` / `revise` functions, so the same logic upgrades LM Studio, OpenAI,
//  and Anthropic identically — and the module is pure enough to unit-test with
//  deterministic fakes (no live model). Local inference is free, so trading
//  wall-clock (N samples, a few rounds) for correctness is the right deal for a
//  vault assistant.

/** Produces a candidate for attempt index `i` (0-based). Vary temperature or the
 *  prompt by `i` upstream so samples are genuinely independent. */
export type Generator<T> = (attempt: number) => Promise<T>;

export interface ConsistencyResult<T> {
  /** The chosen answer (modal, or `pick`ed on tie/freeform). */
  winner: T;
  /** How many samples agreed with the winner (by `key`). */
  votes: number;
  /** Every sampled candidate, in order. */
  candidates: T[];
}

export interface ConsistencyOpts<T> {
  /** Number of independent samples. */
  n: number;
  /** Normalize a candidate to a vote bucket. Default: JSON of the value. */
  key?: (value: T) => string;
  /** Resolve ties / pick among candidates. Default: first of the top bucket. */
  pick?: (candidates: T[]) => T;
}

/**
 * Run `generate` N times and return the most-agreed answer. Samples run
 * sequentially by default (local single-GPU is serial anyway); callers wanting
 * fan-out can pre-build their own Promise.all and pass a memoized generator.
 */
export async function selfConsistency<T>(
  generate: Generator<T>,
  opts: ConsistencyOpts<T>,
): Promise<ConsistencyResult<T>> {
  const n = Math.max(1, opts.n);
  const key = opts.key ?? ((v: T) => JSON.stringify(v));
  const candidates: T[] = [];
  for (let i = 0; i < n; i++) candidates.push(await generate(i));

  // Tally votes by normalized key, preserving first-seen order for stable ties.
  const buckets = new Map<string, { count: number; sample: T }>();
  for (const c of candidates) {
    const k = key(c);
    const b = buckets.get(k);
    if (b) b.count += 1;
    else buckets.set(k, { count: 1, sample: c });
  }
  let topCount = 0;
  for (const b of buckets.values()) if (b.count > topCount) topCount = b.count;
  const topSamples = [...buckets.values()]
    .filter((b) => b.count === topCount)
    .map((b) => b.sample);

  const winner = opts.pick
    ? opts.pick(opts.pick === undefined ? topSamples : candidates)
    : topSamples[0]!;
  // When a custom pick is given, re-derive votes for the picked bucket.
  const votes = opts.pick ? bucketCount(buckets, key, winner) : topCount;
  return { winner, votes, candidates };
}

function bucketCount<T>(
  buckets: Map<string, { count: number; sample: T }>,
  key: (v: T) => string,
  winner: T,
): number {
  return buckets.get(key(winner))?.count ?? 1;
}

export interface Critique {
  ok: boolean;
  feedback: string;
  /** Optional 0..1 quality score for ranking. */
  score?: number;
}
export type Critic<T> = (candidate: T) => Promise<Critique>;
export type Reviser<T> = (candidate: T, feedback: string) => Promise<T>;

export interface ReviseResult<T> {
  value: T;
  /** Number of revise passes performed (0 ⇒ first draft accepted). */
  rounds: number;
  accepted: boolean;
  history: Array<{ value: T; critique: Critique }>;
}

/**
 * Generate an initial candidate, then loop critique→revise until the critic
 * accepts or `maxRounds` revisions are exhausted. Always returns the latest
 * (best-effort) candidate even when never accepted — the caller decides whether
 * to surface a low-confidence answer or escalate.
 */
export async function critiqueRevise<T>(
  initial: () => Promise<T>,
  critique: Critic<T>,
  revise: Reviser<T>,
  opts: { maxRounds?: number } = {},
): Promise<ReviseResult<T>> {
  const maxRounds = Math.max(0, opts.maxRounds ?? 2);
  let value = await initial();
  const history: Array<{ value: T; critique: Critique }> = [];

  let firstVerdict = await critique(value);
  history.push({ value, critique: firstVerdict });
  if (firstVerdict.ok) return { value, rounds: 0, accepted: true, history };

  let rounds = 0;
  let feedback = firstVerdict.feedback;
  while (rounds < maxRounds) {
    value = await revise(value, feedback);
    rounds += 1;
    const verdict = await critique(value);
    history.push({ value, critique: verdict });
    if (verdict.ok) return { value, rounds, accepted: true, history };
    feedback = verdict.feedback;
  }
  return { value, rounds, accepted: false, history };
}

export interface VerifyConfig<T> {
  generate: Generator<T>;
  /** Samples for the consistency vote (1 ⇒ skip voting). Default 1. */
  samples?: number;
  key?: (value: T) => string;
  pick?: (candidates: T[]) => T;
  /** When provided, the voted winner is refined through critique→revise. */
  critique?: Critic<T>;
  revise?: Reviser<T>;
  maxRounds?: number;
}

export interface VerifyResult<T> {
  value: T;
  votes: number;
  rounds: number;
  accepted: boolean;
}

/**
 * Full verify stage: self-consistency vote → (optional) critique-revise refine.
 * The composition order matters — vote first to start refinement from the most
 * reliable draft, then fix its residual flaws.
 */
export async function verify<T>(cfg: VerifyConfig<T>): Promise<VerifyResult<T>> {
  const samples = cfg.samples ?? 1;
  const voted = await selfConsistency(cfg.generate, {
    n: samples,
    ...(cfg.key ? { key: cfg.key } : {}),
    ...(cfg.pick ? { pick: cfg.pick } : {}),
  });

  if (!cfg.critique || !cfg.revise) {
    return { value: voted.winner, votes: voted.votes, rounds: 0, accepted: true };
  }
  const refined = await critiqueRevise(
    () => Promise.resolve(voted.winner),
    cfg.critique,
    cfg.revise,
    cfg.maxRounds != null ? { maxRounds: cfg.maxRounds } : {},
  );
  return {
    value: refined.value,
    votes: voted.votes,
    rounds: refined.rounds,
    accepted: refined.accepted,
  };
}
