// Token-bucket rate-limiter specs. Clock is injected so refill is deterministic.

import { describe, expect, it } from "vitest";

import { TokenBucketRateLimiter } from "./RateLimiter";

describe("TokenBucketRateLimiter", () => {
  it("allows up to capacity then throttles", () => {
    const rl = new TokenBucketRateLimiter({
      capacity: 3,
      refillPerSec: 0.001,
      now: () => 0,
    });
    expect(rl.allow("a")).toBe(true);
    expect(rl.allow("a")).toBe(true);
    expect(rl.allow("a")).toBe(true);
    expect(rl.allow("a")).toBe(false); // bucket empty → 429
  });

  it("buckets are per-key (one flooder cannot starve another addr)", () => {
    const rl = new TokenBucketRateLimiter({
      capacity: 1,
      refillPerSec: 0.001,
      now: () => 0,
    });
    expect(rl.allow("a")).toBe(true);
    expect(rl.allow("a")).toBe(false);
    expect(rl.allow("b")).toBe(true); // distinct addr, fresh bucket
  });

  it("refills over time", () => {
    let t = 0;
    const rl = new TokenBucketRateLimiter({
      capacity: 1,
      refillPerSec: 1, // 1 token/sec
      now: () => t,
    });
    expect(rl.allow("a")).toBe(true);
    expect(rl.allow("a")).toBe(false);
    t = 1000; // +1s → +1 token
    expect(rl.allow("a")).toBe(true);
  });

  it("evicts the oldest bucket past maxKeys (bounded memory)", () => {
    const rl = new TokenBucketRateLimiter({
      capacity: 1,
      refillPerSec: 0.001,
      maxKeys: 2,
      now: () => 0,
    });
    rl.allow("a"); // a now empty
    rl.allow("b");
    rl.allow("c"); // inserts c → evicts a (oldest)
    // a was evicted, so it gets a FRESH full bucket on next touch.
    expect(rl.allow("a")).toBe(true);
  });
});
