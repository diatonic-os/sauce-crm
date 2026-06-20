import { describe, it, expect } from "vitest";
import {
  logistic,
  combineSignals,
  verdict,
  getThreshold,
  DEFAULT_THRESHOLDS,
  FALLBACK_THRESHOLD,
} from "../../src/inference/ConfidenceModel";

describe("logistic()", () => {
  it("is 0.5 at zero and monotone increasing", () => {
    expect(logistic(0)).toBeCloseTo(0.5, 10);
    expect(logistic(-50)).toBeGreaterThan(0);
    expect(logistic(2)).toBeGreaterThan(logistic(1));
    expect(logistic(1000)).toBeLessThanOrEqual(1);
  });

  // The verified defect: a producer that only emits realistic weighted sums
  // (weights summing to ≤1 over features in [0,1] → s ≤ ~1 → conf ≤ ~0.731)
  // can never reach an autoAccept of 1. With the cutoff at 0.95 the producer
  // still stays conservative (→ propose), while external high confidences can
  // auto-accept. (Note: logistic float-saturates to exactly 1 only for s≳37,
  // which combineSignals never produces.)
  it("at realistic weighted sums stays well below the 0.95 auto-accept cutoff", () => {
    const conf = combineSignals([0.5, 0.5], [1, 1]);
    expect(conf).toBeCloseTo(logistic(1), 10);
    expect(conf).toBeLessThan(0.95);
  });
});

describe("combineSignals()", () => {
  it("weights features and squashes through the logistic", () => {
    expect(combineSignals([1, 1], [1, 1])).toBeCloseTo(logistic(2), 10);
  });
  it("tolerates a shorter features array (missing → 0)", () => {
    expect(combineSignals([1, 1], [1])).toBeCloseTo(logistic(1), 10);
  });
});

describe("verdict()", () => {
  it("auto_accept tier is reachable now that the cutoff is < 1", () => {
    expect(verdict(0.96, DEFAULT_THRESHOLDS.knows!)).toBe("auto_accept");
    expect(verdict(1.0, FALLBACK_THRESHOLD)).toBe("auto_accept");
  });
  it("falls to propose between propose and autoAccept cutoffs", () => {
    expect(verdict(0.7, DEFAULT_THRESHOLDS.knows!)).toBe("propose");
  });
  it("discards below the propose cutoff", () => {
    expect(verdict(0.1, DEFAULT_THRESHOLDS.knows!)).toBe("discard");
  });
  it("every default threshold has an achievable autoAccept (< 1)", () => {
    for (const cfg of Object.values(DEFAULT_THRESHOLDS)) {
      expect(cfg.autoAccept).toBeLessThan(1);
    }
    expect(FALLBACK_THRESHOLD.autoAccept).toBeLessThan(1);
  });
});

describe("getThreshold()", () => {
  it("returns the named config, else the fallback", () => {
    expect(getThreshold(DEFAULT_THRESHOLDS, "knows")).toBe(
      DEFAULT_THRESHOLDS.knows,
    );
    expect(getThreshold(DEFAULT_THRESHOLDS, "nope")).toBe(FALLBACK_THRESHOLD);
  });
});
