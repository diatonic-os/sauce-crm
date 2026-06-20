// Statistics.ts — pure descriptive-statistics primitives.
//
// No Obsidian, no I/O. All functions are deterministic and unit-testable.
// `pearson` is the authoritative implementation; RelationshipAnalytics imports
// it from here (Task 2.2).

// ---------------------------------------------------------------------------
// mean
// ---------------------------------------------------------------------------

export function mean(xs: number[]): number | null {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
}

// ---------------------------------------------------------------------------
// stddev  (sample by default; pass sample=false for population)
// ---------------------------------------------------------------------------

export function stddev(xs: number[], sample = true): number | null {
  const m = mean(xs);
  if (m == null) return null;
  const denom = sample ? xs.length - 1 : xs.length;
  if (denom <= 0) return null;
  return Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / denom);
}

// ---------------------------------------------------------------------------
// quantile  (linear interpolation, R type 7 / Excel PERCENTILE.INC)
// ---------------------------------------------------------------------------

export function quantile(xs: number[], q: number): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const pos = (s.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  const a = s[lo] ?? null;
  if (a == null) return null;
  const b = s[hi] ?? a;
  return a + (b - a) * (pos - lo);
}

// ---------------------------------------------------------------------------
// median  (delegates to quantile for consistency)
// ---------------------------------------------------------------------------

export function median(xs: number[]): number | null {
  return quantile(xs, 0.5);
}

// ---------------------------------------------------------------------------
// zscores  (population std-dev; returns 0 for each element when sd = 0)
// ---------------------------------------------------------------------------

export function zscores(xs: number[]): number[] {
  const m = mean(xs);
  const sd = stddev(xs, false);
  if (m == null || !sd) return xs.map(() => 0);
  return xs.map((x) => (x - m) / sd);
}

// ---------------------------------------------------------------------------
// pearson  (moved here from RelationshipAnalytics; re-exported there)
// ---------------------------------------------------------------------------

export function pearson(xs: number[], ys: number[]): number | null {
  const n = Math.min(xs.length, ys.length);
  if (n < 2) return null;
  let sx = 0;
  let sy = 0;
  for (let i = 0; i < n; i++) {
    sx += xs[i]!;
    sy += ys[i]!;
  }
  const mx = sx / n;
  const my = sy / n;
  let num = 0;
  let dx2 = 0;
  let dy2 = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i]! - mx;
    const dy = ys[i]! - my;
    num += dx * dy;
    dx2 += dx * dx;
    dy2 += dy * dy;
  }
  const denom = Math.sqrt(dx2 * dy2);
  if (denom === 0) return null;
  return num / denom;
}

// ---------------------------------------------------------------------------
// spearman  (rank both arrays with average-rank ties, then pearson)
// ---------------------------------------------------------------------------

function rank(xs: number[]): number[] {
  // Create index-sorted pairs, assign average rank for ties.
  const indexed = xs.map((v, i) => ({ v, i }));
  indexed.sort((a, b) => a.v - b.v);
  const ranks = new Array<number>(xs.length);
  let i = 0;
  while (i < indexed.length) {
    let j = i;
    // Find tie group
    while (j + 1 < indexed.length && indexed[j + 1]!.v === indexed[i]!.v) j++;
    const avgRank = (i + j) / 2 + 1; // 1-based
    for (let k = i; k <= j; k++) {
      ranks[indexed[k]!.i] = avgRank;
    }
    i = j + 1;
  }
  return ranks;
}

export function spearman(xs: number[], ys: number[]): number | null {
  const n = Math.min(xs.length, ys.length);
  if (n < 2) return null;
  return pearson(rank(xs.slice(0, n)), rank(ys.slice(0, n)));
}

// ---------------------------------------------------------------------------
// summary
// ---------------------------------------------------------------------------

export interface Summary {
  n: number;
  mean: number;
  median: number;
  sd: number;
  min: number;
  max: number;
  p25: number;
  p75: number;
}

export function summary(xs: number[]): Summary | null {
  if (!xs.length) return null;
  return {
    n: xs.length,
    mean: mean(xs)!,
    median: median(xs)!,
    sd: stddev(xs) ?? 0,
    min: Math.min(...xs),
    max: Math.max(...xs),
    p25: quantile(xs, 0.25)!,
    p75: quantile(xs, 0.75)!,
  };
}
