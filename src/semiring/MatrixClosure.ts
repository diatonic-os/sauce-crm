import { Semiring } from "./Semiring";

export type Matrix<T> = T[][];

export function zeroMatrix<T>(sr: Semiring<T>, n: number): Matrix<T> {
  return Array.from({ length: n }, () =>
    Array.from({ length: n }, () => sr.zero),
  );
}

export function identityMatrix<T>(sr: Semiring<T>, n: number): Matrix<T> {
  const m = zeroMatrix(sr, n);
  // square matrix: i < n, row exists
  for (let i = 0; i < n; i++) m[i]![i] = sr.one;
  return m;
}

export function add<T>(sr: Semiring<T>, a: Matrix<T>, b: Matrix<T>): Matrix<T> {
  const n = a.length;
  const out = zeroMatrix(sr, n);
  // square matrices: i,j < n — all row/cell accesses are in-bounds
  for (let i = 0; i < n; i++) {
    const rowOut = out[i]!;
    const rowA = a[i]!;
    const rowB = b[i]!;
    for (let j = 0; j < n; j++) rowOut[j] = sr.add(rowA[j]!, rowB[j]!);
  }
  return out;
}

export function mul<T>(sr: Semiring<T>, a: Matrix<T>, b: Matrix<T>): Matrix<T> {
  const n = a.length;
  const out = zeroMatrix(sr, n);
  // square matrices: i,j,k < n — all row/cell accesses are in-bounds
  for (let i = 0; i < n; i++) {
    const rowA = a[i]!;
    const rowOut = out[i]!;
    for (let j = 0; j < n; j++) {
      let acc: T = sr.zero;
      for (let k = 0; k < n; k++)
        acc = sr.add(acc, sr.mul(rowA[k]!, b[k]![j]!));
      rowOut[j] = acc;
    }
  }
  return out;
}

export function eqMatrix<T>(
  sr: Semiring<T>,
  a: Matrix<T>,
  b: Matrix<T>,
): boolean {
  const n = a.length;
  // square matrices: i,j < n — all row/cell accesses are in-bounds
  for (let i = 0; i < n; i++) {
    const rowA = a[i]!;
    const rowB = b[i]!;
    for (let j = 0; j < n; j++) if (!sr.eq(rowA[j]!, rowB[j]!)) return false;
  }
  return true;
}

/**
 * Compute H* = ⊕_{k=0}^N H^k via iterative I + H + H^2 + … until stabilization.
 * Stabilizes in at most n iterations on a strongly-connected component.
 */
export function closure<T>(sr: Semiring<T>, h: Matrix<T>): Matrix<T> {
  const n = h.length;
  let acc = identityMatrix(sr, n);
  let pow = identityMatrix(sr, n);
  for (let k = 0; k < n + 1; k++) {
    pow = mul(sr, pow, h);
    const next = add(sr, acc, pow);
    if (eqMatrix(sr, next, acc)) return next;
    acc = next;
  }
  return acc;
}

/**
 * Reconstruct one best path between i and j, consistent with closure()[i][j].
 *
 * Uses Bellman-Ford-style relaxation (repeated full-edge sweeps), which is valid
 * for any closed (idempotent) semiring used here. Dijkstra's "settle a node once
 * and stop" is NOT valid when extending a path can IMPROVE the metric — e.g.
 * MaxPlus (⊕=max, ⊙=+) with positive edge weights, where a longer route can beat
 * a shorter one. The old greedy settle could lock in a suboptimal path whose
 * weight disagreed with closure()[i][j]; this reconstructs a path whose weight
 * equals dist[j] == closure()[i][j].
 */
export function bestPath<T>(
  sr: Semiring<T>,
  h: Matrix<T>,
  i: number,
  j: number,
): number[] | null {
  const n = h.length;
  if (n === 0 || i < 0 || i >= n || j < 0 || j >= n) return null;
  if (i === j) return [i];
  const dist: T[] = Array.from({ length: n }, () => sr.zero);
  const prev: number[] = Array.from({ length: n }, () => -1);
  dist[i] = sr.one;
  // n full sweeps: a best simple path has ≤ n-1 edges, so n-1 sweeps reach the
  // optimum; the extra sweep observes "no change" and breaks early. The pass
  // cap also bounds the work if an improving cycle prevents convergence.
  for (let pass = 0; pass < n; pass++) {
    let changed = false;
    for (let u = 0; u < n; u++) {
      // u unreachable so far → nothing to relax from it
      if (sr.eq(dist[u]!, sr.zero)) continue;
      const rowU = h[u]!;
      for (let v = 0; v < n; v++) {
        const alt = sr.mul(dist[u]!, rowU[v]!);
        if (sr.eq(alt, sr.zero)) continue; // no edge u→v
        const merged = sr.add(dist[v]!, alt);
        if (!sr.eq(merged, dist[v]!)) {
          // The merge strictly improved v, and the improvement came through u,
          // so u is v's best predecessor for the current optimum.
          dist[v] = merged;
          prev[v] = u;
          changed = true;
        }
      }
    }
    if (!changed) break;
  }
  if (sr.eq(dist[j]!, sr.zero) || prev[j]! === -1) return null;
  // Walk predecessors j → … → i. The visited guard is defensive against an
  // improving-cycle prev chain (cannot occur for a converged simple path).
  const path: number[] = [];
  const visited = new Set<number>();
  let cur = j;
  while (cur !== -1) {
    if (visited.has(cur)) return null;
    visited.add(cur);
    path.unshift(cur);
    if (cur === i) break;
    cur = prev[cur]!;
  }
  return path[0]! === i ? path : null;
}
