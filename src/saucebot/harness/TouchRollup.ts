/**
 * TouchRollup — person touch + org rollup record generation.
 *
 * DESIGN: when a person is touched, produce BOTH the person touch record AND
 * an org rollup touch record (if org is present). Records carry frontmatter-style
 * metadata (type, date, year, quarter, source) plus optional context. Year/quarter
 * are derived from input.date or context fields using strict logic; optional fields
 * are omitted (not undefined) to satisfy exactOptionalPropertyTypes.
 *
 * PURE: no obsidian imports, no lancedb, no side effects. All dependencies
 * (date parsing, logic) are local. Testable via vitest with plain objects.
 */

// ─── Public Types ────────────────────────────────────────────────────────────

/**
 * Context metadata for a touch (date, time, quarter, source, optional notes).
 * Pairs of context/summary/transcription fields are optional; omit via
 * conditional spread to satisfy exactOptionalPropertyTypes.
 */
export interface ContextBlock {
  /** ISO date string (YYYY-MM-DD) or similar parseable format. */
  date: string;
  /** Optional time string (HH:MM or similar). */
  time?: string;
  /** Year (e.g. 2026). If not provided, derived from date. */
  year?: number;
  /** Quarter string (e.g. "2026-Q2"). If not provided, derived from date. */
  quarter?: string;
  /** How the touch was recorded: manual entry, transcription, recording. */
  source: "manual" | "transcription" | "recording";
  /** Optional free-form context/scene description. */
  context?: string;
  /** Optional summary of the touch. */
  summary?: string;
  /** Optional transcription of the touch. */
  transcription?: string;
}

/**
 * Input for a touch record: person name, optional org, date, optional channel/author,
 * and a ContextBlock carrying metadata.
 */
export interface TouchInput {
  /** Primary contact person. */
  person: string;
  /** Optional org/company associated with the touch. */
  org?: string;
  /** Touch date (ISO format or parseable). */
  date: string;
  /** Optional contact channel (email, phone, video, etc.). */
  channel?: string;
  /** Optional author/initiator of the touch. */
  author?: string;
  /** Context block with date, source, and optional metadata. */
  context: ContextBlock;
}

/**
 * Output: one person touch record always; org rollup record present iff org
 * is provided in input. Both are plain objects suitable for frontmatter.
 */
export interface RollupResult {
  /** Touch record for the person (type:"touch", contact, date, year, quarter, source, etc.). */
  personTouch: Record<string, unknown>;
  /** Org rollup record (type:"touch", org, contact, date, year, quarter, source, rolled_up:true). Present only if input.org is set. */
  orgTouch?: Record<string, unknown>;
}

// ─── Helpers: Date Parsing ───────────────────────────────────────────────────

/**
 * Extract the year from a date string (ISO YYYY-MM-DD or YYYY).
 * Returns 0 if unparseable.
 */
export function deriveYear(date: string): number {
  if (!date || typeof date !== "string") return 0;
  const match = date.match(/^(\d{4})/);
  if (!match?.[1]) return 0;
  const y = parseInt(match[1], 10);
  return isNaN(y) ? 0 : y;
}

/**
 * Extract the quarter from a date string (ISO YYYY-MM-DD or YYYY-MM).
 * Returns "YYYY-QN" (e.g. "2026-Q2") or "" if unparseable.
 *
 * Quarter mapping: Q1=Jan-Mar (01-03), Q2=Apr-Jun (04-06),
 * Q3=Jul-Sep (07-09), Q4=Oct-Dec (10-12).
 */
export function deriveQuarter(date: string): string {
  if (!date || typeof date !== "string") return "";

  // Try to extract year and month
  const match = date.match(/^(\d{4})-(\d{2})/);
  if (!match?.[1] || !match?.[2]) return "";

  const year = parseInt(match[1], 10);
  const month = parseInt(match[2], 10);

  if (isNaN(year) || isNaN(month) || month < 1 || month > 12) {
    return "";
  }

  let quarter: number;
  if (month >= 1 && month <= 3) quarter = 1;
  else if (month >= 4 && month <= 6) quarter = 2;
  else if (month >= 7 && month <= 9) quarter = 3;
  else quarter = 4;

  return `${year}-Q${quarter}`;
}

// ─── Main: Touch Rollup ──────────────────────────────────────────────────────

/**
 * Generate person touch + optional org rollup records from a TouchInput.
 *
 * LOGIC:
 * 1. Always produce personTouch with frontmatter fields: type, contact, date,
 *    year, quarter, source, plus optional channel, author, context, summary,
 *    transcription (omitted if absent).
 * 2. If input.org is set, also produce orgTouch with: type, org, contact,
 *    date, year, quarter, source, rolled_up:true, plus optional summary
 *    (omitted if absent). orgTouch does NOT include channel, author, or
 *    transcription (person-specific).
 * 3. Year and quarter are derived from context.year/quarter if present,
 *    otherwise from input.date.
 *
 * EXACTOPTIONALPROPERTIES: all optional fields are conditionally spread
 * (omitted when absent, never set to undefined).
 */
export function rollupTouch(input: TouchInput): RollupResult {
  // Derive year and quarter: prefer context fields, fall back to input.date
  const year = input.context.year ?? deriveYear(input.date);
  const quarter = input.context.quarter ?? deriveQuarter(input.date);

  // Build personTouch base (always present)
  const personTouchBase: Record<string, unknown> = {
    type: "touch",
    contact: input.person,
    date: input.date,
    year,
    quarter,
    source: input.context.source,
  };

  // Conditionally add org (if present in input)
  if (input.org !== undefined) {
    personTouchBase.org = input.org;
  }

  // Conditionally add optional fields from input
  if (input.channel !== undefined) {
    personTouchBase.channel = input.channel;
  }
  if (input.author !== undefined) {
    personTouchBase.author = input.author;
  }

  // Conditionally add optional context fields
  if (input.context.context !== undefined) {
    personTouchBase.context = input.context.context;
  }
  if (input.context.summary !== undefined) {
    personTouchBase.summary = input.context.summary;
  }
  if (input.context.transcription !== undefined) {
    personTouchBase.transcription = input.context.transcription;
  }

  const result: RollupResult = {
    personTouch: personTouchBase,
  };

  // Build orgTouch only if org is present
  if (input.org !== undefined) {
    const orgTouchBase: Record<string, unknown> = {
      type: "touch",
      org: input.org,
      contact: input.person,
      date: input.date,
      year,
      quarter,
      source: input.context.source,
      rolled_up: true,
    };

    // Org touch optionally includes summary (but not channel, author, or transcription)
    if (input.context.summary !== undefined) {
      orgTouchBase.summary = input.context.summary;
    }

    result.orgTouch = orgTouchBase;
  }

  return result;
}
