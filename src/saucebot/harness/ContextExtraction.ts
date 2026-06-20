/**
 * ContextExtraction — auto-context extraction agent.
 *
 * Turns raw touch input (manual text / transcription / dropped recording
 * transcript) into a structured ContextBlock and surfaces clarifying
 * questions when context is thin.
 *
 * DESIGN:
 * - Pure module: no obsidian, no lancedb imports.
 * - All LLM capability injected via ContextLLM so unit-tests use fakes.
 * - On LLM failure: falls back to a heuristic block (summary = first ~140
 *   chars of text) so callers never see an unhandled rejection.
 * - Clarifying questions (≤12 words each, ≤3 total) fire when:
 *     1. person is absent
 *     2. date is absent
 *     3. summary is empty after LLM
 *   heuristicAssess from SocraticGate may also contribute questions.
 */

import { heuristicAssess } from "./SocraticGate";

// ─── Public types ──────────────────────────────────────────────────────────────

/**
 * Structured context block produced from a raw touch input.
 * date is always a string (empty string when absent/invalid).
 */
export interface ContextBlock {
  date: string;
  time?: string;
  year: number;
  quarter: string;
  source: "manual" | "transcription" | "recording";
  context?: string;
  summary?: string;
  transcription?: string;
}

/** Raw input from a touch event — a note, transcription, or recording drop. */
export interface RawTouch {
  kind: "manual" | "transcription" | "recording";
  text: string;
  person?: string;
  date?: string;
}

/**
 * Injected LLM extractor dependency. Receives the raw text and resolves
 * with optional summary, context, and extracted entity strings.
 * Any throw triggers graceful fallback.
 */
export type ContextLLM = (
  text: string,
) => Promise<{ summary?: string; context?: string; entities?: string[] }>;

/** Result returned by extractContext. */
export interface ExtractionResult {
  block: ContextBlock;
  questions: string[];
  entities: string[];
}

// ─── Quarter derivation ───────────────────────────────────────────────────────

/** Derive { year, quarter } from an ISO date string (YYYY-MM-DD). */
function deriveYearQuarter(date: string): { year: number; quarter: string } {
  if (!date) return { year: 0, quarter: "" };
  const d = new Date(date);
  if (isNaN(d.getTime())) return { year: 0, quarter: "" };
  const month = d.getUTCMonth() + 1; // 1-12
  const year = d.getUTCFullYear();
  const quarter =
    month <= 3 ? "Q1" : month <= 6 ? "Q2" : month <= 9 ? "Q3" : "Q4";
  return { year, quarter };
}

// ─── Clarifying questions ─────────────────────────────────────────────────────

const MAX_QUESTIONS = 3;

/**
 * Generate clarifying questions based on what is missing from the raw touch
 * and the extracted summary. Delegates to heuristicAssess for additional
 * signal when context is thin.
 */
function buildQuestions(
  raw: RawTouch,
  summary: string | undefined,
): string[] {
  const qs: string[] = [];

  if (!raw.person) {
    qs.push("Who is this touch with?");
  }
  if (!raw.date) {
    qs.push("When did this interaction happen?");
  }
  if (!summary || summary.trim().length === 0) {
    qs.push("What was the main topic discussed?");
  }

  // Enrich via SocraticGate heuristic when still under budget
  if (qs.length < MAX_QUESTIONS) {
    const verdict = heuristicAssess({ query: raw.text });
    for (const q of verdict.questions) {
      if (qs.length >= MAX_QUESTIONS) break;
      if (!qs.includes(q)) qs.push(q);
    }
  }

  return qs.slice(0, MAX_QUESTIONS);
}

// ─── Heuristic fallback block ─────────────────────────────────────────────────

function heuristicBlock(raw: RawTouch): ContextBlock {
  const date = raw.date ?? "";
  const { year, quarter } = deriveYearQuarter(date);
  const summaryStr = raw.text.slice(0, 140).trim();
  const block: ContextBlock = {
    date,
    year,
    quarter,
    source: raw.kind,
    ...(summaryStr ? { summary: summaryStr } : {}),
  };
  if (raw.kind !== "manual") {
    block.transcription = raw.text;
  }
  return block;
}

// ─── Main entry-point ─────────────────────────────────────────────────────────

/**
 * Extract structured context from a raw touch input.
 *
 * Calls `llm(raw.text)` to obtain summary/context/entities. On any LLM
 * failure the extraction degrades to a heuristic block so the caller
 * never receives an unhandled rejection.
 *
 * @param raw   - The raw touch input to process.
 * @param llm   - Injected LLM extractor (swappable in tests).
 * @returns     - Structured ExtractionResult with block, questions, entities.
 */
export async function extractContext(
  raw: RawTouch,
  llm: ContextLLM,
): Promise<ExtractionResult> {
  const date = raw.date ?? "";
  const { year, quarter } = deriveYearQuarter(date);

  let summary: string | undefined;
  let context: string | undefined;
  let entities: string[] = [];
  let usedFallback = false;

  try {
    const result = await llm(raw.text);
    summary = result.summary;
    context = result.context;
    entities = result.entities ?? [];
  } catch {
    usedFallback = true;
    // Heuristic fallback: first ~140 chars as summary
    summary = raw.text.slice(0, 140).trim() || undefined;
  }

  const block: ContextBlock = {
    date,
    year,
    quarter,
    source: raw.kind,
  };

  if (summary !== undefined && summary !== "") {
    block.summary = summary;
  }

  if (context !== undefined && context !== "") {
    block.context = context;
  }

  // Transcription field: set for non-manual kinds
  if (raw.kind !== "manual") {
    block.transcription = raw.text;
  }

  const questions = buildQuestions(raw, block.summary);

  return { block, questions, entities };
}
