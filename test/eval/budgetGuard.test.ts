import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  BudgetGuard,
  BudgetExceededError,
  CircuitOpenError,
} from "./budgetGuard";

const prices = { m: { inUsdPerMtok: 1, outUsdPerMtok: 5 } };

describe("BudgetGuard cost accounting", () => {
  it("computes cost from token usage", () => {
    const g = new BudgetGuard({ platform: "x", capUsd: 10, prices });
    // 1M in @ $1 + 1M out @ $5 = $6
    expect(g.costOf("m", 1_000_000, 1_000_000)).toBeCloseTo(6, 5);
  });
  it("uses the fallback (pricey) for unknown models", () => {
    const g = new BudgetGuard({ platform: "x", capUsd: 10, prices });
    expect(g.costOf("unknown", 1_000_000, 0)).toBe(15); // default fallback in=15
  });
});

describe("hard $ cap", () => {
  it("preflight throws once cumulative spend reaches the cap", () => {
    const g = new BudgetGuard({ platform: "x", capUsd: 0.01, prices });
    g.preflight(); // ok, nothing spent
    g.record("m", 1_000_000, 1_000_000, true); // ~$6, blows the $0.01 cap
    expect(g.isTripped).toBe(true);
    expect(() => g.preflight()).toThrow(BudgetExceededError);
  });
});

describe("call cap", () => {
  it("trips after maxCalls regardless of cost", () => {
    const g = new BudgetGuard({ platform: "x", capUsd: 1000, maxCalls: 2, prices });
    g.preflight(); g.record("m", 0, 0, true);
    g.preflight(); g.record("m", 0, 0, true);
    expect(() => g.preflight()).toThrow(BudgetExceededError);
    expect(g.callCount).toBe(2);
  });
});

describe("circuit breaker", () => {
  it("trips after N consecutive failures and blocks further calls", () => {
    const g = new BudgetGuard({ platform: "x", capUsd: 1000, breakerThreshold: 3, prices });
    for (let i = 0; i < 3; i++) {
      g.preflight();
      g.record("m", 10, 10, false);
    }
    expect(g.isTripped).toBe(true);
    expect(() => g.preflight()).toThrow(CircuitOpenError);
  });
  it("resets the failure streak on a success", () => {
    const g = new BudgetGuard({ platform: "x", capUsd: 1000, breakerThreshold: 3, prices });
    g.record("m", 1, 1, false);
    g.record("m", 1, 1, false);
    g.record("m", 1, 1, true); // reset
    g.record("m", 1, 1, false);
    expect(g.isTripped).toBe(false); // only 1 failure since reset
    expect(() => g.preflight()).not.toThrow();
  });
});

describe("manual hard-kill", () => {
  it("kill() stops all further calls", () => {
    const g = new BudgetGuard({ platform: "x", capUsd: 1000, prices });
    g.kill("operator stop");
    expect(g.isTripped).toBe(true);
    expect(g.reason).toBe("operator stop");
    expect(() => g.preflight()).toThrow(CircuitOpenError);
  });
});

describe("kill-file", () => {
  it("trips when the kill-file appears", () => {
    const dir = mkdtempSync(join(tmpdir(), "kill-"));
    const killFile = join(dir, "STOP");
    const g = new BudgetGuard({ platform: "x", capUsd: 1000, prices, killFile });
    g.preflight(); // file absent → ok
    writeFileSync(killFile, "");
    expect(() => g.preflight()).toThrow(CircuitOpenError);
    expect(g.reason).toMatch(/kill-file/);
  });
});
