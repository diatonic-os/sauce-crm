import { describe, expect, it } from "vitest";
import { nextAfter, parseCron, CronParseError } from "../../src/sync/Cron";

// Helper: build a Date from UTC parts.
function utc(
  year: number,
  month: number, // 1-based
  day: number,
  hour = 0,
  minute = 0,
): Date {
  return new Date(Date.UTC(year, month - 1, day, hour, minute, 0, 0));
}

describe("parseCron", () => {
  it("parses a wildcard expr without throwing", () => {
    const c = parseCron("* * * * *");
    expect(c.minutes.size).toBe(60);
    expect(c.hours.size).toBe(24);
  });

  it("parses step */15 for minutes", () => {
    const c = parseCron("*/15 * * * *");
    expect([...c.minutes].sort((a, b) => a - b)).toEqual([0, 15, 30, 45]);
  });

  it("parses comma lists", () => {
    const c = parseCron("0,30 9,17 * * *");
    expect([...c.minutes]).toEqual(expect.arrayContaining([0, 30]));
    expect([...c.hours]).toEqual(expect.arrayContaining([9, 17]));
    expect(c.minutes.size).toBe(2);
    expect(c.hours.size).toBe(2);
  });

  it("parses range a-b", () => {
    const c = parseCron("0 9-11 * * *");
    expect([...c.hours].sort((a, b) => a - b)).toEqual([9, 10, 11]);
  });

  it("parses range with step a-b/n", () => {
    const c = parseCron("0 0-23/6 * * *");
    expect([...c.hours].sort((a, b) => a - b)).toEqual([0, 6, 12, 18]);
  });

  it("normalises dow 7 to 0 (Sunday)", () => {
    const c = parseCron("0 0 * * 7");
    expect(c.dows.has(0)).toBe(true);
    expect(c.dows.has(7)).toBe(false);
  });

  it("throws on wrong field count", () => {
    expect(() => parseCron("* * * *")).toThrow(CronParseError);
    expect(() => parseCron("* * * * * *")).toThrow(CronParseError);
  });

  it("throws on out-of-range minute", () => {
    expect(() => parseCron("60 * * * *")).toThrow(CronParseError);
  });

  it("throws on out-of-range hour", () => {
    expect(() => parseCron("0 24 * * *")).toThrow(CronParseError);
  });

  it("throws on non-integer step", () => {
    expect(() => parseCron("*/abc * * * *")).toThrow(CronParseError);
  });

  it("throws on step < 1", () => {
    expect(() => parseCron("*/0 * * * *")).toThrow(CronParseError);
  });

  it("throws on empty string", () => {
    expect(() => parseCron("")).toThrow(CronParseError);
  });

  it("throws on range start > end", () => {
    expect(() => parseCron("0 23-9 * * *")).toThrow(CronParseError);
  });
});

describe("nextAfter", () => {
  it("fires at exactly the next matching minute", () => {
    // "15 * * * *" — next fire after 14:00:00 should be 14:15:00
    const from = utc(2026, 1, 1, 14, 0);
    const next = nextAfter("15 * * * *", from);
    expect(next.getUTCHours()).toBe(14);
    expect(next.getUTCMinutes()).toBe(15);
  });

  it("rolls over to the next hour when minute already passed", () => {
    // "10 * * * *" — after 14:20, next should be 15:10
    const from = utc(2026, 1, 1, 14, 20);
    const next = nextAfter("10 * * * *", from);
    expect(next.getUTCHours()).toBe(15);
    expect(next.getUTCMinutes()).toBe(10);
  });

  it("*/15 — every 15 minutes, correct rollover", () => {
    const from = utc(2026, 1, 1, 14, 20);
    const next = nextAfter("*/15 * * * *", from);
    // After :20 next allowed is :30
    expect(next.getUTCMinutes()).toBe(30);
    expect(next.getUTCHours()).toBe(14);
  });

  it("rolls over to the next day when hour already passed", () => {
    // "0 9 * * *" — after 10:00 same day, next should be 09:00 next day
    const from = utc(2026, 1, 1, 10, 0);
    const next = nextAfter("0 9 * * *", from);
    expect(next.getUTCDate()).toBe(2);
    expect(next.getUTCHours()).toBe(9);
    expect(next.getUTCMinutes()).toBe(0);
  });

  it("skips months correctly (month=2 only)", () => {
    const from = utc(2026, 1, 31, 23, 59); // Jan 31
    const next = nextAfter("0 0 1 2 *", from); // 1 Feb at 00:00
    expect(next.getUTCMonth() + 1).toBe(2);
    expect(next.getUTCDate()).toBe(1);
    expect(next.getUTCHours()).toBe(0);
  });

  it("month rollover wraps to next year", () => {
    const from = utc(2026, 3, 1, 0, 1); // March 1, after 00:01
    // "0 0 1 2 *" → next Feb 1 is 2027
    const next = nextAfter("0 0 1 2 *", from);
    expect(next.getUTCFullYear()).toBe(2027);
    expect(next.getUTCMonth() + 1).toBe(2);
  });

  it("respects day-of-week filter", () => {
    // "0 9 * * 1" — Mondays at 09:00.
    // 2026-01-01 is Thursday, so next Monday is 2026-01-05.
    const from = utc(2026, 1, 1, 0, 0);
    const next = nextAfter("0 9 * * 1", from);
    expect(next.getUTCDay()).toBe(1); // Monday
    expect(next.getUTCHours()).toBe(9);
  });

  it("from is exclusive — returns a strictly later time", () => {
    // Exactly matching time: from = 14:15, schedule = "15 14 * * *"
    const from = utc(2026, 1, 1, 14, 15);
    const next = nextAfter("15 14 * * *", from);
    // Should advance to the next day since 14:15 today is not strictly after
    expect(next > from).toBe(true);
    expect(next.getUTCDate()).toBe(2);
  });

  it("throws for impossible expressions (e.g. Feb 31)", () => {
    // Feb 31 never exists
    expect(() => nextAfter("0 0 31 2 *", utc(2026, 1, 1))).toThrow();
  });

  it("throws on invalid cron expression", () => {
    expect(() => nextAfter("bad expr", utc(2026, 1, 1))).toThrow(CronParseError);
  });

  it("comma list — picks the nearest matching value", () => {
    // "0,30 9,17 * * *" after 09:05 → 09:30
    const from = utc(2026, 1, 1, 9, 5);
    const next = nextAfter("0,30 9,17 * * *", from);
    expect(next.getUTCHours()).toBe(9);
    expect(next.getUTCMinutes()).toBe(30);
  });

  it("dow=7 (Sunday alias) works the same as dow=0", () => {
    // Next Sunday after 2026-01-01 (Thursday). Day 0=Sun.
    const from = utc(2026, 1, 1, 0, 0);
    const next7 = nextAfter("0 9 * * 7", from);
    const next0 = nextAfter("0 9 * * 0", from);
    expect(next7.getTime()).toBe(next0.getTime());
  });
});
