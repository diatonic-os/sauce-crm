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
 * Reconstruct one best path between i and j via predecessor matrix.
 * Uses Dijkstra-style relaxation under the semiring.
 */
export function bestPath<T>(
  sr: Semiring<T>,
  h: Matrix<T>,
  i: number,
  j: number,
): number[] | null {
  const n = h.length;
  const dist: T[] = Array.from({ length: n }, () => sr.zero);
  const prev: number[] = Array.from({ length: n }, () => -1);
  dist[i] = sr.one;
  const visited = new Set<number>();
  for (let _step = 0; _step < n; _step++) {
    let u = -1;
    let best: T = sr.zero;
    // v < n: dist[] has length n, all accesses in-bounds
    for (let v = 0; v < n; v++) {
      if (visited.has(v)) continue;
      if (u === -1 || !sr.eq(sr.add(best, dist[v]!), best)) {
        if (u === -1 || dominates(sr, dist[v]!, best)) {
          u = v;
          best = dist[v]!;
        }
      }
    }
    if (u === -1 || sr.eq(best, sr.zero)) break;
    visited.add(u);
    if (u === j) break;
    // u,v < n: dist[], h[], prev[] all have length n; h rows have length n
    for (let v = 0; v < n; v++) {
      if (visited.has(v)) continue;
      const alt = sr.mul(dist[u]!, h[u]![v]!);
      const merged = sr.add(dist[v]!, alt);
      if (!sr.eq(merged, dist[v]!)) {
        dist[v] = merged;
        prev[v] = u;
      }
    }
  }
  // j is a valid node index (caller guards j < n via buildIndex)
  if (prev[j]! === -1 && i !== j) return null;
  const path: number[] = [];
  let cur = j;
  while (cur !== -1) {
    path.unshift(cur);
    if (cur === i) break;
    // cur is either a valid node index or -1 (loop terminates on -1)
    cur = prev[cur]!;
  }
  // path always contains at least j; path[0] is defined
  return path[0]! === i ? path : null;
}

function dominates<T>(sr: Semiring<T>, a: T, b: T): boolean {
  // a "wins" if a ⊕ b === a but a !== b
  if (sr.eq(a, b)) return false;
  return sr.eq(sr.add(a, b), a);
}
