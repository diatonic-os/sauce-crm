import { describe, it, expect, vi } from "vitest";
import {
  isRetriableStatus,
  backoffMs,
  withRetry,
  type RetryResponse,
} from "../../src/saucebot/httpRetry";

const ok = (): RetryResponse => ({ status: 200, headers: {}, body: "ok" });
const rate = (retryAfter?: string): RetryResponse => ({
  status: 429,
  headers: retryAfter ? { "retry-after": retryAfter } : {},
  body: "rate limited",
});
const bad = (): RetryResponse => ({ status: 400, headers: {}, body: "bad request" });

describe("isRetriableStatus()", () => {
  it("retries 429 and 5xx, not other 4xx or 2xx", () => {
    expect(isRetriableStatus(429)).toBe(true);
    expect(isRetriableStatus(500)).toBe(true);
    expect(isRetriableStatus(503)).toBe(true);
    expect(isRetriableStatus(400)).toBe(false);
    expect(isRetriableStatus(404)).toBe(false);
    expect(isRetriableStatus(200)).toBe(false);
  });
});

describe("backoffMs()", () => {
  it("is exponential in the attempt index and capped", () => {
    expect(backoffMs(0, undefined, 500, 20_000)).toBeGreaterThanOrEqual(500);
    expect(backoffMs(1, undefined, 500, 20_000)).toBeGreaterThanOrEqual(1000);
    expect(backoffMs(2, undefined, 500, 20_000)).toBeGreaterThanOrEqual(2000);
    expect(backoffMs(20, undefined, 500, 20_000)).toBe(20_000); // capped
  });
  it("honors a numeric Retry-After (seconds)", () => {
    expect(backoffMs(0, "3", 500, 20_000)).toBe(3000);
    expect(backoffMs(0, "999", 500, 20_000)).toBe(20_000); // capped
  });
  it("honors an HTTP-date Retry-After relative to now", () => {
    const now = 1_000_000;
    const when = new Date(now + 4000).toUTCString();
    expect(backoffMs(0, when, 500, 20_000, now)).toBeGreaterThanOrEqual(3000);
    expect(backoffMs(0, when, 500, 20_000, now)).toBeLessThanOrEqual(5000);
  });
});

describe("withRetry()", () => {
  it("returns immediately on a 2xx (no sleep)", async () => {
    const sleep = vi.fn(async () => {});
    const fn = vi.fn(async () => ok());
    const r = await withRetry(fn, { sleep });
    expect(r.status).toBe(200);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("retries a 429 then succeeds", async () => {
    const sleep = vi.fn(async () => {});
    let n = 0;
    const fn = vi.fn(async () => (++n < 3 ? rate() : ok()));
    const r = await withRetry(fn, { sleep, maxRetries: 4 });
    expect(r.status).toBe(200);
    expect(fn).toHaveBeenCalledTimes(3); // 2 retries
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it("gives up after maxRetries and returns the last retriable response", async () => {
    const sleep = vi.fn(async () => {});
    const fn = vi.fn(async () => rate());
    const r = await withRetry(fn, { sleep, maxRetries: 2 });
    expect(r.status).toBe(429);
    expect(fn).toHaveBeenCalledTimes(3); // initial + 2 retries
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it("does NOT retry a non-retriable 4xx", async () => {
    const sleep = vi.fn(async () => {});
    const fn = vi.fn(async () => bad());
    const r = await withRetry(fn, { sleep });
    expect(r.status).toBe(400);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("passes the Retry-After header into the backoff sleep", async () => {
    const slept: number[] = [];
    const sleep = vi.fn(async (ms: number) => void slept.push(ms));
    let n = 0;
    const fn = vi.fn(async () => (++n < 2 ? rate("2") : ok()));
    await withRetry(fn, { sleep });
    expect(slept[0]).toBe(2000);
  });
});
