// SPEC §S5 — 5-field cron expression parser. nextAfter(expr, fromDate) → Date.
// ReDoS-safe: NO dynamic regex. Tokenizes by splitting on whitespace/comma and
// parses integers. Throws on invalid expressions (no silent failure).
//
// Field order: min hour dom mon dow
//   * = every
//   a,b = list
//   a-b = range
//   */n = every n (from min of field)
//   a-b/n = every n within range
//
// dow: 0 = Sunday … 6 = Saturday (7 is also Sunday per cron convention).
// mon: 1–12.

export class CronParseError extends Error {
  constructor(msg: string) {
    super(`CronParseError: ${msg}`);
    this.name = "CronParseError";
  }
}

interface FieldSpec {
  min: number;
  max: number;
}

const FIELD_SPECS: FieldSpec[] = [
  { min: 0, max: 59 }, // minute
  { min: 0, max: 23 }, // hour
  { min: 1, max: 31 }, // dom
  { min: 1, max: 12 }, // month
  { min: 0, max: 7 }, // dow (0/7=Sun, 1=Mon…6=Sat; 7 normalised to 0 after parsing)
];

/** Parse a single cron field token into a sorted, deduplicated set of allowed values. */
function parseField(token: string, spec: FieldSpec): Set<number> {
  const { min, max } = spec;
  const result = new Set<number>();

  // Split on comma to get individual terms (list items)
  const parts = token.split(",");
  for (const part of parts) {
    if (!part) throw new CronParseError(`empty part in token "${token}"`);
    parseTerm(part.trim(), min, max, result);
  }
  return result;
}

/** Parse one term (no commas) — handles *, range, step, or literal integer. */
function parseTerm(
  term: string,
  min: number,
  max: number,
  out: Set<number>,
): void {
  // Detect step: anything/n
  const slashIdx = term.indexOf("/");
  let step = 1;
  let rangeStr = term;

  if (slashIdx !== -1) {
    const stepStr = term.slice(slashIdx + 1);
    const n = parseIntStrict(stepStr);
    if (n < 1) throw new CronParseError(`step must be ≥1, got "${stepStr}"`);
    step = n;
    rangeStr = term.slice(0, slashIdx);
  }

  let rangeMin: number;
  let rangeMax: number;

  if (rangeStr === "*") {
    rangeMin = min;
    rangeMax = max;
  } else {
    const dashIdx = rangeStr.indexOf("-");
    if (dashIdx !== -1) {
      const a = parseIntStrict(rangeStr.slice(0, dashIdx));
      const b = parseIntStrict(rangeStr.slice(dashIdx + 1));
      assertInRange(a, min, max, rangeStr);
      assertInRange(b, min, max, rangeStr);
      if (a > b) throw new CronParseError(`range start > end in "${rangeStr}"`);
      rangeMin = a;
      rangeMax = b;
    } else {
      const v = parseIntStrict(rangeStr);
      assertInRange(v, min, max, rangeStr);
      rangeMin = v;
      rangeMax = v;
    }
  }

  for (let v = rangeMin; v <= rangeMax; v += step) {
    out.add(v);
  }
}

function parseIntStrict(s: string): number {
  if (!/^\d+$/.test(s))
    throw new CronParseError(`expected integer, got "${s}"`);
  return parseInt(s, 10);
}

function assertInRange(v: number, min: number, max: number, ctx: string): void {
  if (v < min || v > max)
    throw new CronParseError(
      `value ${v} out of range [${min},${max}] in "${ctx}"`,
    );
}

/** Parsed cron expression (5 sets of allowed values). */
interface ParsedCron {
  minutes: Set<number>;
  hours: Set<number>;
  doms: Set<number>;
  months: Set<number>;
  dows: Set<number>;
}

/** Parse and validate a 5-field cron expression string. */
export function parseCron(expr: string): ParsedCron {
  const fields = expr.trim().split(/\s+/);
  if (fields.length !== 5)
    throw new CronParseError(
      `expected 5 fields, got ${fields.length} in "${expr}"`,
    );

  // fields.length === 5 is validated above; all five destructured vars are defined.
  const [minF, hourF, domF, monF, dowF] = fields as [string, string, string, string, string];

  const minutes = parseField(minF, FIELD_SPECS[0]!); // FIELD_SPECS has 5 elements
  const hours = parseField(hourF, FIELD_SPECS[1]!);
  const doms = parseField(domF, FIELD_SPECS[2]!);
  const months = parseField(monF, FIELD_SPECS[3]!);
  const dowsRaw = parseField(dowF, FIELD_SPECS[4]!);

  // Normalise dow 7 → 0 (Sunday)
  const dows = new Set<number>();
  for (const d of dowsRaw) dows.add(d === 7 ? 0 : d);

  return { minutes, hours, doms, months, dows };
}

/**
 * Return the next Date strictly after `fromDate` that satisfies the 5-field
 * cron expression. All arithmetic is done in UTC so the result is
 * timezone-invariant.
 *
 * Throws `CronParseError` if the expression is invalid.
 * Throws `Error` if no matching date is found within 4 years (guard against
 * impossible expressions like "31 * * 2 *").
 */
export function nextAfter(expr: string, fromDate: Date): Date {
  const cron = parseCron(expr);

  // Start from the next whole minute after fromDate (exclusive).
  // Work in epoch-ms increments aligned to minute boundaries.
  const fromMs = fromDate.getTime();
  // Truncate to current minute then add one minute.
  const startMs = Math.floor(fromMs / 60_000) * 60_000 + 60_000;

  // Deadline: 4 years ahead.
  const deadlineMs = startMs + 4 * 366 * 86_400_000;

  let ms = startMs;

  while (ms < deadlineMs) {
    const d = new Date(ms);

    const mon = d.getUTCMonth() + 1; // 1-12
    if (!cron.months.has(mon)) {
      // Jump to first day of next UTC month.
      ms = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1, 0, 0, 0, 0);
      continue;
    }

    const dom = d.getUTCDate();
    const dow = d.getUTCDay(); // 0=Sun
    if (!cron.doms.has(dom) || !cron.dows.has(dow)) {
      // Jump to start of next UTC day.
      ms = Date.UTC(
        d.getUTCFullYear(),
        d.getUTCMonth(),
        d.getUTCDate() + 1,
        0,
        0,
        0,
        0,
      );
      continue;
    }

    const hour = d.getUTCHours();
    if (!cron.hours.has(hour)) {
      const nextHour = nextIn(cron.hours, hour + 1, 23);
      if (nextHour === null) {
        // Jump to start of next UTC day.
        ms = Date.UTC(
          d.getUTCFullYear(),
          d.getUTCMonth(),
          d.getUTCDate() + 1,
          0,
          0,
          0,
          0,
        );
      } else {
        ms = Date.UTC(
          d.getUTCFullYear(),
          d.getUTCMonth(),
          d.getUTCDate(),
          nextHour,
          0,
          0,
          0,
        );
      }
      continue;
    }

    const minute = d.getUTCMinutes();
    if (!cron.minutes.has(minute)) {
      const nextMin = nextIn(cron.minutes, minute + 1, 59);
      if (nextMin === null) {
        // No valid minute this hour — jump to next valid hour.
        const nextHour = nextIn(cron.hours, hour + 1, 23);
        if (nextHour === null) {
          ms = Date.UTC(
            d.getUTCFullYear(),
            d.getUTCMonth(),
            d.getUTCDate() + 1,
            0,
            0,
            0,
            0,
          );
        } else {
          ms = Date.UTC(
            d.getUTCFullYear(),
            d.getUTCMonth(),
            d.getUTCDate(),
            nextHour,
            0,
            0,
            0,
          );
        }
      } else {
        ms = Date.UTC(
          d.getUTCFullYear(),
          d.getUTCMonth(),
          d.getUTCDate(),
          hour,
          nextMin,
          0,
          0,
        );
      }
      continue;
    }

    // All fields match — return with seconds/ms zeroed.
    return new Date(
      Date.UTC(
        d.getUTCFullYear(),
        d.getUTCMonth(),
        d.getUTCDate(),
        hour,
        minute,
        0,
        0,
      ),
    );
  }

  throw new Error(
    `nextAfter: no matching date found within 4 years for cron "${expr}"`,
  );
}

/** Return the smallest value in `set` that is >= `from` and <= `max`, or null. */
function nextIn(set: Set<number>, from: number, max: number): number | null {
  for (let v = from; v <= max; v++) {
    if (set.has(v)) return v;
  }
  return null;
}
