/**
 * Tests for TouchRollup — person touch + org rollup record generation.
 *
 * WHY: a touch record captures a single person interaction; when org is
 * present, produce BOTH the person touch and a parallel org-contextualized
 * rollup record with year/quarter derived from context or date. Pure function,
 * no side effects, strict optional-field handling.
 */

import { describe, it, expect } from "vitest";
import {
  deriveYear,
  deriveQuarter,
  rollupTouch,
} from "../../src/saucebot/harness/TouchRollup";
import type {
  ContextBlock,
  TouchInput,
  RollupResult,
} from "../../src/saucebot/harness/TouchRollup";

// ─── deriveYear ──────────────────────────────────────────────────────────────

describe("deriveYear", () => {
  it("extracts year from ISO date string (YYYY-MM-DD)", () => {
    expect(deriveYear("2026-01-15")).toBe(2026);
    expect(deriveYear("2025-12-31")).toBe(2025);
    expect(deriveYear("2000-06-01")).toBe(2000);
  });

  it("handles year-only strings", () => {
    expect(deriveYear("2026")).toBe(2026);
  });

  it("handles invalid/unparseable dates gracefully", () => {
    const result = deriveYear("not-a-date");
    expect(typeof result).toBe("number");
    expect(result).toBe(0);
  });

  it("handles empty string", () => {
    expect(deriveYear("")).toBe(0);
  });

  it("handles partial dates gracefully", () => {
    const result = deriveYear("202-13");
    expect(typeof result).toBe("number");
  });
});

// ─── deriveQuarter ───────────────────────────────────────────────────────────

describe("deriveQuarter", () => {
  it("derives Q1 from Jan-Mar dates", () => {
    expect(deriveQuarter("2026-01-15")).toBe("2026-Q1");
    expect(deriveQuarter("2026-02-28")).toBe("2026-Q1");
    expect(deriveQuarter("2026-03-31")).toBe("2026-Q1");
  });

  it("derives Q2 from Apr-Jun dates", () => {
    expect(deriveQuarter("2026-04-01")).toBe("2026-Q2");
    expect(deriveQuarter("2026-05-15")).toBe("2026-Q2");
    expect(deriveQuarter("2026-06-30")).toBe("2026-Q2");
  });

  it("derives Q3 from Jul-Sep dates", () => {
    expect(deriveQuarter("2026-07-15")).toBe("2026-Q3");
    expect(deriveQuarter("2026-08-15")).toBe("2026-Q3");
    expect(deriveQuarter("2026-09-30")).toBe("2026-Q3");
  });

  it("derives Q4 from Oct-Dec dates", () => {
    expect(deriveQuarter("2026-10-01")).toBe("2026-Q4");
    expect(deriveQuarter("2026-11-15")).toBe("2026-Q4");
    expect(deriveQuarter("2026-12-31")).toBe("2026-Q4");
  });

  it("returns empty string for invalid dates", () => {
    expect(deriveQuarter("not-a-date")).toBe("");
    expect(deriveQuarter("")).toBe("");
  });

  it("handles month-day only (no year) gracefully", () => {
    const result = deriveQuarter("01-15");
    expect(typeof result).toBe("string");
  });
});

// ─── rollupTouch ────────────────────────────────────────────────────────────

describe("rollupTouch — person touch without org", () => {
  it("produces personTouch only when org is absent", () => {
    const input: TouchInput = {
      person: "Alice",
      date: "2026-05-15",
      context: {
        date: "2026-05-15",
        year: 2026,
        quarter: "2026-Q2",
        source: "manual",
      },
    };

    const result = rollupTouch(input);

    expect(result.personTouch).toBeDefined();
    expect(result.orgTouch).toBeUndefined();
  });

  it("produces personTouch with all expected fields", () => {
    const input: TouchInput = {
      person: "Alice",
      date: "2026-05-15",
      channel: "email",
      author: "Drew",
      context: {
        date: "2026-05-15",
        year: 2026,
        quarter: "2026-Q2",
        source: "manual",
        summary: "Discussed project roadmap",
        context: "Planning session",
      },
    };

    const result = rollupTouch(input);
    const touch = result.personTouch as Record<string, unknown>;

    expect(touch.type).toBe("touch");
    expect(touch.contact).toBe("Alice");
    expect(touch.date).toBe("2026-05-15");
    expect(touch.channel).toBe("email");
    expect(touch.author).toBe("Drew");
    expect(touch.year).toBe(2026);
    expect(touch.quarter).toBe("2026-Q2");
    expect(touch.source).toBe("manual");
    expect(touch.summary).toBe("Discussed project roadmap");
    expect(touch.context).toBe("Planning session");
  });

  it("omits optional fields when absent (exactOptionalPropertyTypes)", () => {
    const input: TouchInput = {
      person: "Bob",
      date: "2026-05-15",
      context: {
        date: "2026-05-15",
        year: 2026,
        quarter: "2026-Q2",
        source: "transcription",
      },
    };

    const result = rollupTouch(input);
    const touch = result.personTouch as Record<string, unknown>;

    // These should not be present in the object
    expect("channel" in touch).toBe(false);
    expect("author" in touch).toBe(false);
    expect("summary" in touch).toBe(false);
    expect("context" in touch).toBe(false);
    expect("transcription" in touch).toBe(false);
  });

  it("carries transcription field when present", () => {
    const input: TouchInput = {
      person: "Charlie",
      date: "2026-05-15",
      context: {
        date: "2026-05-15",
        year: 2026,
        quarter: "2026-Q2",
        source: "recording",
        transcription: "We discussed quarterly targets",
      },
    };

    const result = rollupTouch(input);
    const touch = result.personTouch as Record<string, unknown>;

    expect(touch.transcription).toBe("We discussed quarterly targets");
  });
});

// ─── rollupTouch — person + org ──────────────────────────────────────────────

describe("rollupTouch — person touch with org produces rollup", () => {
  it("produces both personTouch and orgTouch when org is set", () => {
    const input: TouchInput = {
      person: "Alice",
      org: "Acme Corp",
      date: "2026-05-15",
      context: {
        date: "2026-05-15",
        year: 2026,
        quarter: "2026-Q2",
        source: "manual",
      },
    };

    const result = rollupTouch(input);

    expect(result.personTouch).toBeDefined();
    expect(result.orgTouch).toBeDefined();
  });

  it("personTouch includes org when org is provided", () => {
    const input: TouchInput = {
      person: "Alice",
      org: "Acme Corp",
      date: "2026-05-15",
      context: {
        date: "2026-05-15",
        year: 2026,
        quarter: "2026-Q2",
        source: "manual",
      },
    };

    const result = rollupTouch(input);
    const personTouch = result.personTouch as Record<string, unknown>;

    expect(personTouch.org).toBe("Acme Corp");
  });

  it("orgTouch has rolled_up:true flag", () => {
    const input: TouchInput = {
      person: "Alice",
      org: "Acme Corp",
      date: "2026-05-15",
      context: {
        date: "2026-05-15",
        year: 2026,
        quarter: "2026-Q2",
        source: "manual",
      },
    };

    const result = rollupTouch(input);
    const orgTouch = result.orgTouch as Record<string, unknown>;

    expect(orgTouch.rolled_up).toBe(true);
  });

  it("orgTouch has org, contact (person), date, year, quarter, source", () => {
    const input: TouchInput = {
      person: "Alice",
      org: "Acme Corp",
      date: "2026-05-15",
      channel: "phone",
      context: {
        date: "2026-05-15",
        year: 2026,
        quarter: "2026-Q2",
        source: "manual",
      },
    };

    const result = rollupTouch(input);
    const orgTouch = result.orgTouch as Record<string, unknown>;

    expect(orgTouch.type).toBe("touch");
    expect(orgTouch.org).toBe("Acme Corp");
    expect(orgTouch.contact).toBe("Alice");
    expect(orgTouch.date).toBe("2026-05-15");
    expect(orgTouch.year).toBe(2026);
    expect(orgTouch.quarter).toBe("2026-Q2");
    expect(orgTouch.source).toBe("manual");
  });

  it("orgTouch includes summary when present", () => {
    const input: TouchInput = {
      person: "Alice",
      org: "Acme Corp",
      date: "2026-05-15",
      context: {
        date: "2026-05-15",
        year: 2026,
        quarter: "2026-Q2",
        source: "manual",
        summary: "Quarterly business review",
      },
    };

    const result = rollupTouch(input);
    const orgTouch = result.orgTouch as Record<string, unknown>;

    expect(orgTouch.summary).toBe("Quarterly business review");
  });

  it("orgTouch omits summary and transcription when absent", () => {
    const input: TouchInput = {
      person: "Alice",
      org: "Acme Corp",
      date: "2026-05-15",
      context: {
        date: "2026-05-15",
        year: 2026,
        quarter: "2026-Q2",
        source: "manual",
      },
    };

    const result = rollupTouch(input);
    const orgTouch = result.orgTouch as Record<string, unknown>;

    expect("summary" in orgTouch).toBe(false);
    expect("transcription" in orgTouch).toBe(false);
  });

  it("orgTouch does NOT include channel or author", () => {
    const input: TouchInput = {
      person: "Alice",
      org: "Acme Corp",
      date: "2026-05-15",
      channel: "email",
      author: "Drew",
      context: {
        date: "2026-05-15",
        year: 2026,
        quarter: "2026-Q2",
        source: "manual",
      },
    };

    const result = rollupTouch(input);
    const orgTouch = result.orgTouch as Record<string, unknown>;

    expect("channel" in orgTouch).toBe(false);
    expect("author" in orgTouch).toBe(false);
  });
});

// ─── rollupTouch — year/quarter derivation ──────────────────────────────────

describe("rollupTouch — derives year/quarter from context or date", () => {
  it("uses context.year and context.quarter when both are provided", () => {
    const input: TouchInput = {
      person: "Alice",
      date: "2026-05-15",
      context: {
        date: "2026-05-15",
        year: 2025,
        quarter: "2025-Q4",
        source: "manual",
      },
    };

    const result = rollupTouch(input);
    const touch = result.personTouch as Record<string, unknown>;

    // Should use the provided year/quarter, not derived from date
    expect(touch.year).toBe(2025);
    expect(touch.quarter).toBe("2025-Q4");
  });

  it("derives year/quarter from date when not in context", () => {
    const input: TouchInput = {
      person: "Alice",
      date: "2026-07-15",
      context: {
        date: "2026-07-15",
        source: "manual",
        // year and quarter intentionally omitted
      },
    };

    const result = rollupTouch(input);
    const touch = result.personTouch as Record<string, unknown>;

    expect(touch.year).toBe(2026);
    expect(touch.quarter).toBe("2026-Q3");
  });

  it("derives from input.date when context.date differs (input.date takes priority)", () => {
    const input: TouchInput = {
      person: "Alice",
      date: "2026-10-01",
      context: {
        date: "2026-05-15",
        source: "manual",
      },
    };

    const result = rollupTouch(input);
    const touch = result.personTouch as Record<string, unknown>;

    // Should derive from input.date (the primary touch date)
    expect(touch.year).toBe(2026);
    expect(touch.quarter).toBe("2026-Q4");
  });
});

// ─── rollupTouch — context field pass-through ───────────────────────────────

describe("rollupTouch — context field handling", () => {
  it("includes context string when present in ContextBlock", () => {
    const input: TouchInput = {
      person: "Alice",
      date: "2026-05-15",
      context: {
        date: "2026-05-15",
        year: 2026,
        quarter: "2026-Q2",
        source: "manual",
        context: "Annual partner planning",
      },
    };

    const result = rollupTouch(input);
    const touch = result.personTouch as Record<string, unknown>;

    expect(touch.context).toBe("Annual partner planning");
  });

  it("omits context field when not in ContextBlock", () => {
    const input: TouchInput = {
      person: "Alice",
      date: "2026-05-15",
      context: {
        date: "2026-05-15",
        year: 2026,
        quarter: "2026-Q2",
        source: "manual",
      },
    };

    const result = rollupTouch(input);
    const touch = result.personTouch as Record<string, unknown>;

    expect("context" in touch).toBe(false);
  });
});

// ─── rollupTouch — multiple sources ─────────────────────────────────────────

describe("rollupTouch — source values", () => {
  it("preserves source=manual", () => {
    const input: TouchInput = {
      person: "Alice",
      date: "2026-05-15",
      context: {
        date: "2026-05-15",
        year: 2026,
        quarter: "2026-Q2",
        source: "manual",
      },
    };

    const result = rollupTouch(input);
    const touch = result.personTouch as Record<string, unknown>;

    expect(touch.source).toBe("manual");
  });

  it("preserves source=transcription", () => {
    const input: TouchInput = {
      person: "Alice",
      date: "2026-05-15",
      context: {
        date: "2026-05-15",
        year: 2026,
        quarter: "2026-Q2",
        source: "transcription",
      },
    };

    const result = rollupTouch(input);
    const touch = result.personTouch as Record<string, unknown>;

    expect(touch.source).toBe("transcription");
  });

  it("preserves source=recording", () => {
    const input: TouchInput = {
      person: "Alice",
      date: "2026-05-15",
      context: {
        date: "2026-05-15",
        year: 2026,
        quarter: "2026-Q2",
        source: "recording",
      },
    };

    const result = rollupTouch(input);
    const touch = result.personTouch as Record<string, unknown>;

    expect(touch.source).toBe("recording");
  });
});

// ─── rollupTouch — integration ──────────────────────────────────────────────

describe("rollupTouch — integration scenarios", () => {
  it("full touch with person, org, all optional fields", () => {
    const input: TouchInput = {
      person: "Alice Smith",
      org: "Acme Corp",
      date: "2026-05-15",
      channel: "video",
      author: "Drew Fortini",
      context: {
        date: "2026-05-15",
        time: "14:30",
        year: 2026,
        quarter: "2026-Q2",
        source: "recording",
        context: "Strategic partnership discussion",
        summary: "Discussed H2 roadmap alignment",
        transcription: "Alice mentioned... We agreed to...",
      },
    };

    const result = rollupTouch(input);

    // Check personTouch
    const personTouch = result.personTouch as Record<string, unknown>;
    expect(personTouch.type).toBe("touch");
    expect(personTouch.contact).toBe("Alice Smith");
    expect(personTouch.org).toBe("Acme Corp");
    expect(personTouch.date).toBe("2026-05-15");
    expect(personTouch.channel).toBe("video");
    expect(personTouch.author).toBe("Drew Fortini");
    expect(personTouch.year).toBe(2026);
    expect(personTouch.quarter).toBe("2026-Q2");
    expect(personTouch.source).toBe("recording");
    expect(personTouch.context).toBe("Strategic partnership discussion");
    expect(personTouch.summary).toBe("Discussed H2 roadmap alignment");
    expect(personTouch.transcription).toBe("Alice mentioned... We agreed to...");

    // Check orgTouch
    const orgTouch = result.orgTouch as Record<string, unknown>;
    expect(orgTouch.type).toBe("touch");
    expect(orgTouch.org).toBe("Acme Corp");
    expect(orgTouch.contact).toBe("Alice Smith");
    expect(orgTouch.date).toBe("2026-05-15");
    expect(orgTouch.year).toBe(2026);
    expect(orgTouch.quarter).toBe("2026-Q2");
    expect(orgTouch.source).toBe("recording");
    expect(orgTouch.summary).toBe("Discussed H2 roadmap alignment");
    expect(orgTouch.rolled_up).toBe(true);

    // Org touch should not have person-specific fields
    expect("channel" in orgTouch).toBe(false);
    expect("author" in orgTouch).toBe(false);
    expect("transcription" in orgTouch).toBe(false);
  });

  it("minimal touch with only required fields", () => {
    const input: TouchInput = {
      person: "Bob",
      date: "2026-01-01",
      context: {
        date: "2026-01-01",
        year: 2026,
        quarter: "2026-Q1",
        source: "manual",
      },
    };

    const result = rollupTouch(input);

    const personTouch = result.personTouch as Record<string, unknown>;
    expect(personTouch).toHaveProperty("type", "touch");
    expect(personTouch).toHaveProperty("contact", "Bob");
    expect(personTouch).toHaveProperty("date", "2026-01-01");
    expect(personTouch).toHaveProperty("year", 2026);
    expect(personTouch).toHaveProperty("quarter", "2026-Q1");
    expect(personTouch).toHaveProperty("source", "manual");

    // Should have no orgTouch when org is absent
    expect(result.orgTouch).toBeUndefined();
  });
});
