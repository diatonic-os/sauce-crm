// ─────────────────────────────────────────────────────────────────────────────
//  Tests for SAUCEOM_HARNESS_DIRECTIVE @L1_input_analysis — IntentSplit module
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect, vi } from "vitest";
import {
  analyzeInput,
  analyzeInputAI,
  type IntentClassifier,
  type AnalysisResult,
  type IntentSplit,
} from "../../src/saucebot/harness/IntentSplit";

// ─────────────────────────────────────────────────────────────────────────────
//  Entity extraction
// ─────────────────────────────────────────────────────────────────────────────

describe("entity extraction — wikilinks", () => {
  it("extracts [[wikilinks]] as entities", () => {
    const result = analyzeInput("Create a note for [[Jane Doe]] and link it to [[Project Alpha]]");
    expect(result.frame.what.entities).toContain("Jane Doe");
    expect(result.frame.what.entities).toContain("Project Alpha");
  });

  it("extracts a single wikilink", () => {
    const result = analyzeInput("Open [[Meeting Notes]]");
    expect(result.frame.what.entities).toContain("Meeting Notes");
  });
});

describe("entity extraction — Capitalized Names", () => {
  it("extracts multi-word Capitalized Names that are not wikilinks", () => {
    const result = analyzeInput("Schedule a meeting with Alice Johnson about the roadmap");
    expect(result.frame.what.entities).toContain("Alice Johnson");
  });

  it("does not include common sentence-start words as entities", () => {
    const result = analyzeInput("The project is due today");
    // "The" should not appear as an entity
    expect(result.frame.what.entities).not.toContain("The");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
//  Urgency detection
// ─────────────────────────────────────────────────────────────────────────────

describe("urgency detection", () => {
  it("detects 'asap' as high urgency", () => {
    const result = analyzeInput("I need this done asap");
    expect(result.frame.when.urgency).toBe("high");
    expect(result.frame.when.temporalRefs).toContain("asap");
  });

  it("detects 'today' as high urgency", () => {
    const result = analyzeInput("Please complete this today");
    expect(result.frame.when.urgency).toBe("high");
    expect(result.frame.when.temporalRefs).toContain("today");
  });

  it("detects 'now' as high urgency", () => {
    const result = analyzeInput("Do it now");
    expect(result.frame.when.urgency).toBe("high");
    expect(result.frame.when.temporalRefs).toContain("now");
  });

  it("detects 'soon' as medium urgency", () => {
    const result = analyzeInput("Can you get to this soon?");
    expect(result.frame.when.urgency).toBe("medium");
    expect(result.frame.when.temporalRefs).toContain("soon");
  });

  it("detects 'by <date>' pattern as high urgency", () => {
    const result = analyzeInput("Finish this by Friday");
    expect(result.frame.when.urgency).toBe("high");
    const hasDateRef = result.frame.when.temporalRefs.some((r) =>
      r.toLowerCase().includes("friday"),
    );
    expect(hasDateRef).toBe(true);
  });

  it("defaults to low urgency when no temporal words", () => {
    const result = analyzeInput("Create a person note for [[Jane]]");
    expect(result.frame.when.urgency).toBe("low");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
//  targetOutputType inference
// ─────────────────────────────────────────────────────────────────────────────

describe("targetOutputType inference", () => {
  it("infers 'list' for list/enumerate requests", () => {
    const result = analyzeInput("List all the tasks for this project");
    expect(result.frame.what.targetOutputType).toBe("list");
  });

  it("infers 'plan' for planning requests", () => {
    const result = analyzeInput("Create a plan to migrate the database");
    expect(result.frame.what.targetOutputType).toBe("plan");
  });

  it("infers 'draft' for draft/write/compose requests", () => {
    const result = analyzeInput("Write a draft email to the client");
    expect(result.frame.what.targetOutputType).toBe("draft");
  });

  it("infers 'edit' for edit/update/fix requests", () => {
    const result = analyzeInput("Edit the first paragraph of this note");
    expect(result.frame.what.targetOutputType).toBe("edit");
  });

  it("infers 'answer' as default", () => {
    const result = analyzeInput("What is the capital of France?");
    expect(result.frame.what.targetOutputType).toBe("answer");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
//  Divergence flag
// ─────────────────────────────────────────────────────────────────────────────

describe("divergenceFlag", () => {
  it("sets divergenceFlag=true for emotional reassurance vs concrete doing mismatch", () => {
    // "I am worried" signals reassurance need; "just tell me it is fine" is still
    // emotive not action-oriented — but the test exercises the reassurance path.
    const result = analyzeInput("I am worried, just tell me it is fine");
    expect(result.split.divergenceFlag).toBe(true);
  });

  it("sets divergenceFlag=false for purely concrete action request", () => {
    const result = analyzeInput("Create a person note for [[Jane]]");
    expect(result.split.divergenceFlag).toBe(false);
  });

  it("sets divergenceFlag=true when emotional need is 'control' but concrete actions present", () => {
    const result = analyzeInput(
      "I need to be in control of this, please do exactly what I say and create a new note titled [[Status Report]]",
    );
    // Has concrete actions AND control-seeking language → divergence
    expect(result.split.divergenceFlag).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
//  openQuestions on low-confidence / vague input
// ─────────────────────────────────────────────────────────────────────────────

describe("openQuestions", () => {
  it("populates openQuestions for vague low-confidence input", () => {
    const result = analyzeInput("umm I dunno maybe something");
    expect(result.openQuestions.length).toBeGreaterThan(0);
  });

  it("produces empty or sparse openQuestions for high-confidence clear input", () => {
    const result = analyzeInput(
      "Create a person note for [[Jane]] with tags #person and link to [[Project Atlas]]",
    );
    // High confidence on a concrete request should not produce many questions
    expect(result.openQuestions.length).toBeLessThanOrEqual(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
//  analyzeInputAI — merge + fallback
// ─────────────────────────────────────────────────────────────────────────────

describe("analyzeInputAI", () => {
  it("merges classifier output over heuristic result", async () => {
    const classifier: IntentClassifier = vi.fn(async () => ({
      logical: {
        taskClass: "AI-classified-task",
        successCriteria: ["criterion-A"],
        conf: 0.95,
      },
    }));

    const result = await analyzeInputAI(
      "Create a person note for [[Jane]]",
      classifier,
    );

    // Classifier's logical should override heuristic's logical
    expect(result.split.logical.taskClass).toBe("AI-classified-task");
    expect(result.split.logical.successCriteria).toContain("criterion-A");
    expect(result.split.logical.conf).toBe(0.95);

    // Frame from heuristic should still be present
    expect(result.frame.what.entities).toContain("Jane");
  });

  it("falls back to heuristic when classifier throws", async () => {
    const classifier: IntentClassifier = vi.fn(async () => {
      throw new Error("AI provider unavailable");
    });

    const result = await analyzeInputAI(
      "Create a person note for [[Jane]]",
      classifier,
    );

    // Should still return a valid result from heuristic
    expect(result.frame.what.entities).toContain("Jane");
    expect(typeof result.split.logical.taskClass).toBe("string");
    expect(result.split.divergenceFlag).toBe(false);
  });

  it("partial merge: only overrides provided fields", async () => {
    const classifier: IntentClassifier = vi.fn(async () => ({
      execution: {
        concreteActions: ["ai-action-1"],
        toolsImplied: ["vault_write"],
        conf: 0.9,
      },
    }));

    const heuristic = analyzeInput("List all open tasks for [[Alice]]");
    const result = await analyzeInputAI(
      "List all open tasks for [[Alice]]",
      classifier,
    );

    // Merged execution from AI
    expect(result.split.execution.concreteActions).toContain("ai-action-1");
    // Emotional from heuristic preserved
    expect(result.split.emotional.need).toBe(heuristic.split.emotional.need);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
//  Structural shape / type checks
// ─────────────────────────────────────────────────────────────────────────────

describe("AnalysisResult structural shape", () => {
  it("returns a valid AnalysisResult with all required keys", () => {
    const result: AnalysisResult = analyzeInput("Show me the summary of [[Q2 Report]]");

    // SocraticFrame
    expect(result.frame).toBeDefined();
    expect(typeof result.frame.why.goalInferred).toBe("string");
    expect(Array.isArray(result.frame.why.motivationSignals)).toBe(true);
    expect(typeof result.frame.why.conf).toBe("number");
    expect(Array.isArray(result.frame.what.entities)).toBe(true);
    expect(Array.isArray(result.frame.what.artifacts)).toBe(true);
    expect(typeof result.frame.what.targetOutputType).toBe("string");
    expect(["file", "vault", "org", "system", "web"]).toContain(result.frame.where.scope);
    expect(typeof result.frame.where.locus).toBe("string");
    expect(["low", "medium", "high"]).toContain(result.frame.when.urgency);
    expect(Array.isArray(result.frame.when.temporalRefs)).toBe(true);
    expect(typeof result.frame.when.schedulingNeeded).toBe("boolean");
    expect(typeof result.frame.how.preferredMethod).toBe("string");
    expect(Array.isArray(result.frame.how.constraints)).toBe(true);
    expect(typeof result.frame.how.toneRequest).toBe("string");

    // IntentSplit
    expect(result.split).toBeDefined();
    expect(typeof result.split.emotional.affect).toBe("string");
    expect(["reassurance", "speed", "control", "clarity"]).toContain(
      result.split.emotional.need,
    );
    expect(typeof result.split.emotional.conf).toBe("number");
    expect(typeof result.split.logical.taskClass).toBe("string");
    expect(Array.isArray(result.split.logical.successCriteria)).toBe(true);
    expect(typeof result.split.logical.conf).toBe("number");
    expect(Array.isArray(result.split.execution.concreteActions)).toBe(true);
    expect(Array.isArray(result.split.execution.toolsImplied)).toBe(true);
    expect(typeof result.split.execution.conf).toBe("number");
    expect(typeof result.split.divergenceFlag).toBe("boolean");

    // openQuestions
    expect(Array.isArray(result.openQuestions)).toBe(true);
  });
});
