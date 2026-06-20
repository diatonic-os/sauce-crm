/**
 * Tests for SocraticGate — the clarification-before-answering guard.
 *
 * WHY: risky assumptions silently baked into answers erode user trust and
 * produce wrong actions. A gate that asks ONE sharp question beats an answer
 * that assumes the wrong "him", the wrong "recently", or the wrong org.
 */

import { describe, it, expect, vi } from "vitest";
import {
  heuristicAssess,
  assessAssumptions,
} from "../../src/saucebot/harness/SocraticGate";
import type {
  AssumptionVerdict,
  GateInput,
  Classifier,
} from "../../src/saucebot/harness/SocraticGate";

// ─── heuristicAssess ─────────────────────────────────────────────────────────

describe("heuristicAssess — ambiguous pronoun triggers clarification", () => {
  it("flags 'follow up with him about that' with questions", () => {
    const result = heuristicAssess({ query: "follow up with him about that" });
    expect(result.needsClarification).toBe(true);
    expect(result.questions.length).toBeGreaterThan(0);
    expect(result.questions.length).toBeLessThanOrEqual(2);
    result.questions.forEach((q) => {
      // each question must be ≤12 words
      expect(q.trim().split(/\s+/).length).toBeLessThanOrEqual(12);
    });
  });

  it("flags 'reach out to her about it' — pronoun chain without named entity", () => {
    const result = heuristicAssess({ query: "reach out to her about it" });
    expect(result.needsClarification).toBe(true);
  });

  it("flags 'connect with them about this' — vague pronoun + vague action", () => {
    const result = heuristicAssess({
      query: "connect with them about this",
    });
    expect(result.needsClarification).toBe(true);
  });
});

describe("heuristicAssess — vague scope triggers clarification", () => {
  it("flags 'ping everyone on the team soon'", () => {
    const result = heuristicAssess({ query: "ping everyone on the team soon" });
    expect(result.needsClarification).toBe(true);
  });

  it("flags 'send the update to all recently'", () => {
    const result = heuristicAssess({ query: "send the update to all recently" });
    expect(result.needsClarification).toBe(true);
  });
});

describe("heuristicAssess — underspecified action verb triggers clarification", () => {
  it("flags 'follow up with them' — no named person", () => {
    const result = heuristicAssess({ query: "follow up with them" });
    expect(result.needsClarification).toBe(true);
  });

  it("flags 'reach out' with no org mentioned", () => {
    const result = heuristicAssess({ query: "reach out" });
    expect(result.needsClarification).toBe(true);
  });
});

describe("heuristicAssess — clear queries return needsClarification false", () => {
  it("'Summarize my last touch with [[Jane Doe]]' is clear", () => {
    const result = heuristicAssess({
      query: "Summarize my last touch with [[Jane Doe]]",
    });
    expect(result.needsClarification).toBe(false);
    expect(result.questions).toHaveLength(0);
    expect(result.confidence).toBe("high");
  });

  it("'Schedule a meeting with Acme Corp next Tuesday' is clear", () => {
    const result = heuristicAssess({
      query: "Schedule a meeting with Acme Corp next Tuesday",
    });
    expect(result.needsClarification).toBe(false);
    expect(result.questions).toHaveLength(0);
  });

  it("pronoun resolved by contextSummary named entity is clear", () => {
    const result = heuristicAssess({
      query: "follow up with him about the contract",
      contextSummary: "You just met with John Smith at Acme Corp.",
    });
    expect(result.needsClarification).toBe(false);
  });
});

// ─── assessAssumptions ───────────────────────────────────────────────────────

describe("assessAssumptions — uses classifier when provided", () => {
  it("returns classifier result when classifier succeeds", async () => {
    const classifierVerdict: AssumptionVerdict = {
      needsClarification: true,
      questions: ["Which project are you referring to?"],
      confidence: "high",
      reason: "ambiguous project reference",
    };
    const classifier: Classifier = vi.fn().mockResolvedValue(classifierVerdict);
    const input: GateInput = { query: "update the project" };

    const result = await assessAssumptions(input, classifier);

    expect(classifier).toHaveBeenCalledWith(input);
    expect(result).toEqual(classifierVerdict);
  });

  it("falls back to heuristicAssess when classifier throws", async () => {
    const classifier: Classifier = vi
      .fn()
      .mockRejectedValue(new Error("LLM timeout"));
    const input: GateInput = { query: "follow up with him about that" };

    const result = await assessAssumptions(input, classifier);

    // Fell back to heuristic — should still flag this as needing clarification
    expect(result.needsClarification).toBe(true);
    expect(result.questions.length).toBeGreaterThan(0);
  });
});

describe("assessAssumptions — heuristic path when no classifier", () => {
  it("flags ambiguous query", async () => {
    const input: GateInput = { query: "connect with him soon" };
    const result = await assessAssumptions(input);
    expect(result.needsClarification).toBe(true);
  });

  it("clears unambiguous query", async () => {
    const input: GateInput = {
      query: "Show tasks assigned to Alice Nguyen this week",
    };
    const result = await assessAssumptions(input);
    expect(result.needsClarification).toBe(false);
  });
});

// ─── verdict shape contract ───────────────────────────────────────────────────

describe("AssumptionVerdict shape", () => {
  it("ambiguous verdict has confidence low or medium", () => {
    const result = heuristicAssess({ query: "reach out to them about it" });
    expect(result.needsClarification).toBe(true);
    expect(["low", "medium"]).toContain(result.confidence);
  });

  it("clear verdict has confidence high", () => {
    const result = heuristicAssess({
      query: "List all emails from Sarah Connor at Cyberdyne",
    });
    expect(result.confidence).toBe("high");
  });
});
