import { describe, it, expect } from "vitest";
import {
  zeroMatrix,
  identityMatrix,
  closure,
  bestPath,
} from "../../src/semiring/MatrixClosure";
import type { Semiring } from "../../src/semiring/Semiring";
import { MaxPlus } from "../../src/semiring/MaxPlus";
import { MinPlus } from "../../src/semiring/MinPlus";

function mat(
  sr: Semiring<number>,
  n: number,
  edges: [number, number, number][],
): number[][] {
  const m = zeroMatrix(sr, n);
  for (const [i, j, w] of edges) m[i]![j] = w;
  return m;
}

/** ⊙ is + for both MaxPlus and MinPlus, so a path's weight is the edge sum. */
function pathWeight(m: number[][], path: number[]): number {
  let w = 0;
  for (let k = 0; k + 1 < path.length; k++) w += m[path[k]!]![path[k + 1]!]!;
  return w;
}

describe("closure()", () => {
  it("closure of the zero matrix is the identity", () => {
    expect(closure(MinPlus, zeroMatrix(MinPlus, 3))).toEqual(
      identityMatrix(MinPlus, 3),
    );
  });

  it("n=1 single node closes to the ⊙-identity on the diagonal", () => {
    const c = closure(MinPlus, zeroMatrix(MinPlus, 1));
    expect(c[0]![0]).toBe(MinPlus.one); // 0
  });

  it("n=0 empty matrix returns an empty matrix", () => {
    expect(closure(MinPlus, [])).toEqual([]);
  });

  it("MinPlus picks the cheaper multi-hop route over a costly direct edge", () => {
    const m = mat(MinPlus, 3, [
      [0, 2, 100],
      [0, 1, 1],
      [1, 2, 1],
    ]);
    expect(closure(MinPlus, m)[0]![2]).toBe(2);
  });

  it("MaxPlus picks the higher-scoring multi-hop route", () => {
    const m = mat(MaxPlus, 3, [
      [0, 2, 100],
      [0, 1, 1],
      [1, 2, 1000],
    ]);
    expect(closure(MaxPlus, m)[0]![2]).toBe(1001);
  });

  it("disconnected nodes stay at ⊕-zero (unreachable)", () => {
    const m = mat(MinPlus, 3, [[0, 1, 5]]);
    const star = closure(MinPlus, m);
    expect(star[0]![2]).toBe(MinPlus.zero); // Infinity
    expect(star[2]![0]).toBe(MinPlus.zero);
  });

  it("self-loops on the diagonal do not break convergence", () => {
    // MinPlus self-loop weight 0 (idempotent) — closure stays finite.
    const m = mat(MinPlus, 2, [
      [0, 0, 0],
      [0, 1, 3],
    ]);
    const star = closure(MinPlus, m);
    expect(star[0]![1]).toBe(3);
    expect(star[0]![0]).toBe(0);
  });
});

describe("bestPath() / closure() consistency", () => {
  // Regression for the MaxPlus Dijkstra-settle bug: the old greedy settle
  // returned [0,2] (weight 100) while the closure metric was 1001.
  it("MaxPlus: reconstructed path agrees with the closure metric (counterexample)", () => {
    const m = mat(MaxPlus, 3, [
      [0, 2, 100],
      [0, 1, 1],
      [1, 2, 1000],
    ]);
    const star = closure(MaxPlus, m);
    const path = bestPath(MaxPlus, m, 0, 2);
    expect(path).toEqual([0, 1, 2]);
    expect(pathWeight(m, path!)).toBe(star[0]![2]); // 1001, not 100
  });

  it("MinPlus: reconstructed path agrees with the closure metric", () => {
    const m = mat(MinPlus, 3, [
      [0, 2, 100],
      [0, 1, 1],
      [1, 2, 1],
    ]);
    const star = closure(MinPlus, m);
    const path = bestPath(MinPlus, m, 0, 2);
    expect(path).toEqual([0, 1, 2]);
    expect(pathWeight(m, path!)).toBe(star[0]![2]); // 2
  });

  it("a longer 3-hop chain is reconstructed end-to-end", () => {
    const m = mat(MaxPlus, 4, [
      [0, 3, 5],
      [0, 1, 2],
      [1, 2, 2],
      [2, 3, 2],
    ]);
    // 0->1->2->3 = 6 beats direct 0->3 = 5
    expect(closure(MaxPlus, m)[0]![3]).toBe(6);
    expect(bestPath(MaxPlus, m, 0, 3)).toEqual([0, 1, 2, 3]);
  });

  it("returns [i] for i===j and null for an unreachable target", () => {
    const m = mat(MaxPlus, 3, [[0, 1, 5]]);
    expect(bestPath(MaxPlus, m, 1, 1)).toEqual([1]);
    expect(bestPath(MaxPlus, m, 0, 2)).toBeNull();
  });

  it("guards out-of-range endpoints", () => {
    const m = mat(MinPlus, 2, [[0, 1, 1]]);
    expect(bestPath(MinPlus, m, -1, 0)).toBeNull();
    expect(bestPath(MinPlus, m, 0, 5)).toBeNull();
  });
});

describe("semiring eq() NaN handling", () => {
  it("MinPlus.eq treats NaN as equal to NaN (consistent with MaxPlus)", () => {
    expect(MinPlus.eq(NaN, NaN)).toBe(true);
    expect(MaxPlus.eq(NaN, NaN)).toBe(true);
  });
});
