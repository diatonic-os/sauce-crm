// @vitest-environment node
//
// Task 2.1 — Statistics.ts primitive unit tests.

import { describe, expect, it } from "vitest";
import {
  mean,
  median,
  stddev,
  quantile,
  zscores,
  spearman,
  summary,
  pearson,
} from "@/services/stats/Statistics";

describe("mean/median/stddev", () => {
  it("computes mean correctly", () => {
    expect(mean([2, 4, 6])).toBe(4);
  });

  it("computes median with linear interpolation for even-length array", () => {
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });

  it("computes sample stddev", () => {
    expect(stddev([2, 4, 4, 4, 5, 5, 7, 9])).toBeCloseTo(2.138, 3);
  });
});

describe("quantile linear-interp", () => {
  it("computes p50 as median", () => {
    expect(quantile([1, 2, 3, 4], 0.5)).toBe(2.5);
  });
  it("computes p25 with linear interpolation", () => {
    expect(quantile([1, 2, 3, 4], 0.25)).toBe(1.75);
  });
});

describe("zscores center to 0 mean", () => {
  it("zscores sum to near-zero mean", () => {
    const z = zscores([1, 2, 3]);
    expect(mean(z)).toBeCloseTo(0, 10);
  });
});

describe("spearman of monotonic = 1", () => {
  it("returns 1 for perfect monotonic relationship", () => {
    expect(spearman([1, 2, 3, 4], [10, 20, 30, 40])).toBeCloseTo(1, 10);
  });
});

describe("empty → null", () => {
  it("mean of empty returns null", () => {
    expect(mean([])).toBeNull();
  });
  it("summary of empty returns null", () => {
    expect(summary([])).toBeNull();
  });
});

describe("pearson (re-exported from Statistics)", () => {
  it("computes a perfect positive correlation", () => {
    expect(pearson([1, 2, 3, 4], [2, 4, 6, 8])).toBeCloseTo(1, 6);
  });
  it("returns null for zero variance", () => {
    expect(pearson([5, 5, 5], [1, 2, 3])).toBeNull();
  });
});

describe("summary", () => {
  it("returns all stats fields", () => {
    const s = summary([1, 2, 3, 4]);
    expect(s).not.toBeNull();
    expect(s!.n).toBe(4);
    expect(s!.mean).toBe(2.5);
    expect(s!.median).toBe(2.5);
    expect(s!.min).toBe(1);
    expect(s!.max).toBe(4);
    expect(s!.p25).toBe(1.75);
    expect(s!.p75).toBe(3.25);
  });
});

describe("spearman with ties", () => {
  it("handles ties with average ranks", () => {
    // [1,2,2,3] — tied 2s get rank (2+3)/2 = 2.5
    const r = spearman([1, 2, 2, 3], [10, 20, 30, 40]);
    expect(r).not.toBeNull();
    // monotonically related, but ties dampen to < 1
    expect(r!).toBeGreaterThan(0.9);
  });
});
