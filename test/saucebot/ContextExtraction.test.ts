/**
 * Tests for ContextExtraction — auto-context extraction agent.
 *
 * WHY: raw touch input (notes, transcriptions, recording drops) must be
 * normalised into a structured ContextBlock before it can be stored in
 * the graph. This suite proves:
 *   - LLM summary/context/entities pass through correctly
 *   - source and transcription fields are set per kind
 *   - year/quarter are derived from the date string
 *   - clarifying questions fire when person/date/summary are absent
 *   - llm rejections fall back gracefully (no throw)
 *   - entities are forwarded from the llm response
 */

import { describe, it, expect, vi } from "vitest";
import {
  extractContext,
} from "../../src/saucebot/harness/ContextExtraction";
import type {
  RawTouch,
  ContextLLM,
  ExtractionResult,
  ContextBlock,
} from "../../src/saucebot/harness/ContextExtraction";

// ─── helpers ─────────────────────────────────────────────────────────────────

function makeLLM(
  overrides: Partial<Awaited<ReturnType<ContextLLM>>> = {},
): ContextLLM {
  return vi.fn(async () => ({
    summary: "They discussed the Q2 pipeline.",
    context: "Sales meeting at HQ.",
    entities: ["Alice", "Bob"],
    ...overrides,
  }));
}

// ─── summary + context from llm ──────────────────────────────────────────────

describe("extractContext — extracts summary and context from llm", () => {
  it("populates block.summary and block.context from llm response", async () => {
    const raw: RawTouch = {
      kind: "manual",
      text: "Talked about pipeline improvements",
      person: "Jane Doe",
      date: "2025-04-10",
    };
    const llm = makeLLM({ summary: "Pipeline chat", context: "Sales call" });
    const result: ExtractionResult = await extractContext(raw, llm);
    expect(result.block.summary).toBe("Pipeline chat");
    expect(result.block.context).toBe("Sales call");
  });

  it("calls llm with the raw text", async () => {
    const llm = makeLLM();
    const raw: RawTouch = { kind: "manual", text: "Hello world", person: "P", date: "2024-01-15" };
    await extractContext(raw, llm);
    expect(llm).toHaveBeenCalledWith("Hello world");
  });
});

// ─── source + transcription per kind ─────────────────────────────────────────

describe("extractContext — source and transcription by kind", () => {
  it("sets source=transcription and transcription=raw.text for transcription kind", async () => {
    const raw: RawTouch = {
      kind: "transcription",
      text: "Full meeting transcript here",
      person: "Alex",
      date: "2025-06-01",
    };
    const result = await extractContext(raw, makeLLM());
    expect(result.block.source).toBe("transcription");
    expect(result.block.transcription).toBe("Full meeting transcript here");
  });

  it("sets source=recording and transcription=raw.text for recording kind", async () => {
    const raw: RawTouch = {
      kind: "recording",
      text: "Audio transcription content",
      person: "Sam",
      date: "2025-07-15",
    };
    const result = await extractContext(raw, makeLLM());
    expect(result.block.source).toBe("recording");
    expect(result.block.transcription).toBe("Audio transcription content");
  });

  it("does NOT set transcription for manual kind", async () => {
    const raw: RawTouch = {
      kind: "manual",
      text: "Some manual note",
      person: "Drew",
      date: "2025-01-20",
    };
    const result = await extractContext(raw, makeLLM());
    expect(result.block.source).toBe("manual");
    expect(result.block.transcription).toBeUndefined();
  });
});

// ─── year + quarter derivation ────────────────────────────────────────────────

describe("extractContext — year and quarter from date", () => {
  const cases: Array<{ date: string; year: number; quarter: string }> = [
    { date: "2025-01-05", year: 2025, quarter: "Q1" },
    { date: "2025-02-28", year: 2025, quarter: "Q1" },
    { date: "2025-03-31", year: 2025, quarter: "Q1" },
    { date: "2025-04-01", year: 2025, quarter: "Q2" },
    { date: "2025-05-15", year: 2025, quarter: "Q2" },
    { date: "2025-06-30", year: 2025, quarter: "Q2" },
    { date: "2025-07-01", year: 2025, quarter: "Q3" },
    { date: "2025-09-30", year: 2025, quarter: "Q3" },
    { date: "2025-10-01", year: 2025, quarter: "Q4" },
    { date: "2025-12-31", year: 2025, quarter: "Q4" },
  ];

  for (const { date, year, quarter } of cases) {
    it(`date ${date} → year=${year} quarter=${quarter}`, async () => {
      const raw: RawTouch = { kind: "manual", text: "note", person: "P", date };
      const result = await extractContext(raw, makeLLM());
      expect(result.block.year).toBe(year);
      expect(result.block.quarter).toBe(quarter);
    });
  }

  it("year=0 and quarter='' when date is missing", async () => {
    const raw: RawTouch = { kind: "manual", text: "note", person: "P" };
    const result = await extractContext(raw, makeLLM());
    expect(result.block.year).toBe(0);
    expect(result.block.quarter).toBe("");
    expect(result.block.date).toBe("");
  });

  it("year=0 and quarter='' for invalid date string", async () => {
    const raw: RawTouch = { kind: "manual", text: "note", person: "P", date: "not-a-date" };
    const result = await extractContext(raw, makeLLM());
    expect(result.block.year).toBe(0);
    expect(result.block.quarter).toBe("");
  });
});

// ─── clarifying questions ─────────────────────────────────────────────────────

describe("extractContext — clarifying questions", () => {
  it("emits a question when person is missing", async () => {
    const raw: RawTouch = { kind: "manual", text: "Pipeline talk", date: "2025-03-10" };
    const result = await extractContext(raw, makeLLM({ summary: "Pipeline talk" }));
    expect(result.questions.some((q) => /who|person|contact/i.test(q))).toBe(true);
  });

  it("emits a question when date is missing", async () => {
    const raw: RawTouch = { kind: "manual", text: "Meeting notes", person: "Alice" };
    const result = await extractContext(raw, makeLLM({ summary: "Meeting notes" }));
    expect(result.questions.some((q) => /when|date|time/i.test(q))).toBe(true);
  });

  it("emits a question when summary is empty after llm", async () => {
    const raw: RawTouch = { kind: "manual", text: "x", person: "Bob", date: "2025-05-01" };
    const result = await extractContext(raw, makeLLM({ summary: "" }));
    expect(result.questions.some((q) => /what|topic|about/i.test(q))).toBe(true);
  });

  it("emits multiple questions when both person and date are missing", async () => {
    const raw: RawTouch = { kind: "manual", text: "Some note" };
    const result = await extractContext(raw, makeLLM());
    expect(result.questions.length).toBeGreaterThanOrEqual(2);
  });

  it("each question is at most 12 words", async () => {
    const raw: RawTouch = { kind: "manual", text: "note" };
    const result = await extractContext(raw, makeLLM({ summary: "" }));
    for (const q of result.questions) {
      expect(q.trim().split(/\s+/).length).toBeLessThanOrEqual(12);
    }
  });

  it("emits no more than 3 questions total", async () => {
    const raw: RawTouch = { kind: "manual", text: "x" };
    const result = await extractContext(raw, makeLLM({ summary: "" }));
    expect(result.questions.length).toBeLessThanOrEqual(3);
  });

  it("emits no questions when person, date, and summary are all present", async () => {
    const raw: RawTouch = { kind: "manual", text: "Full note", person: "Jane", date: "2025-04-05" };
    const result = await extractContext(raw, makeLLM({ summary: "Full note" }));
    expect(result.questions).toHaveLength(0);
  });
});

// ─── llm fallback on rejection ───────────────────────────────────────────────

describe("extractContext — graceful fallback when llm rejects", () => {
  it("does not throw when llm rejects", async () => {
    const failLLM: ContextLLM = vi.fn(async () => {
      throw new Error("LLM unavailable");
    });
    const raw: RawTouch = { kind: "manual", text: "Something happened with the deal", person: "Drew", date: "2025-08-12" };
    await expect(extractContext(raw, failLLM)).resolves.toBeDefined();
  });

  it("falls back to first ~140 chars of text as summary on llm failure", async () => {
    const failLLM: ContextLLM = vi.fn(async () => { throw new Error("timeout"); });
    const longText = "A".repeat(200);
    const raw: RawTouch = { kind: "manual", text: longText, person: "Drew", date: "2025-09-01" };
    const result = await extractContext(raw, failLLM);
    expect(result.block.summary).toBeDefined();
    expect((result.block.summary ?? "").length).toBeLessThanOrEqual(145);
  });

  it("fallback block still has correct source/date/year/quarter", async () => {
    const failLLM: ContextLLM = vi.fn(async () => { throw new Error("error"); });
    const raw: RawTouch = { kind: "transcription", text: "Fallback text", person: "Sam", date: "2025-11-15" };
    const result = await extractContext(raw, failLLM);
    expect(result.block.source).toBe("transcription");
    expect(result.block.year).toBe(2025);
    expect(result.block.quarter).toBe("Q4");
  });
});

// ─── entities pass-through ───────────────────────────────────────────────────

describe("extractContext — entities from llm", () => {
  it("passes entities from llm response into ExtractionResult.entities", async () => {
    const raw: RawTouch = { kind: "manual", text: "Meeting", person: "P", date: "2025-02-10" };
    const result = await extractContext(raw, makeLLM({ entities: ["Alice", "Acme Corp"] }));
    expect(result.entities).toContain("Alice");
    expect(result.entities).toContain("Acme Corp");
  });

  it("entities is empty array when llm returns none", async () => {
    const raw: RawTouch = { kind: "manual", text: "Note", person: "P", date: "2025-03-01" };
    const result = await extractContext(raw, makeLLM({ entities: undefined }));
    expect(Array.isArray(result.entities)).toBe(true);
    expect(result.entities).toHaveLength(0);
  });

  it("entities is empty array on llm fallback", async () => {
    const failLLM: ContextLLM = vi.fn(async () => { throw new Error("fail"); });
    const raw: RawTouch = { kind: "manual", text: "Note", person: "P", date: "2025-03-01" };
    const result = await extractContext(raw, failLLM);
    expect(Array.isArray(result.entities)).toBe(true);
    expect(result.entities).toHaveLength(0);
  });
});
