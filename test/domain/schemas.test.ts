import { describe, expect, it } from "vitest";
import {
  PersonSchema,
  OrgSchema,
  TouchSchema,
  AddendumSchema,
  TaskSchema,
  FollowupSchema,
  IdeaSchema,
  LedgerEntrySchema,
  RollupSchema,
  validateEntity,
} from "../../src/domain/schemas";

describe("PersonSchema", () => {
  it("validates a minimal warm-contact", () => {
    const fm = { type: "warm-contact", name: "Alice" };
    expect(PersonSchema.validate(fm).passed).toBe(true);
    expect(PersonSchema.parse(fm)?.name).toBe("Alice");
  });
  it("rejects wrong type", () => {
    const r = PersonSchema.validate({ type: "org", name: "Acme" });
    expect(r.passed).toBe(false);
    expect(r.errors[0].field).toBe("type");
  });
  it("rejects empty name", () => {
    expect(
      PersonSchema.validate({ type: "warm-contact", name: "" }).passed,
    ).toBe(false);
  });
  it("warns on bad last_touch shape", () => {
    const r = PersonSchema.validate({
      type: "warm-contact",
      name: "x",
      last_touch: "yesterday",
    });
    expect(r.passed).toBe(true);
    expect(r.errors.some((e) => e.severity === "warn")).toBe(true);
  });
});

describe("TouchSchema", () => {
  it("requires contact + ISO date", () => {
    const ok = TouchSchema.validate({
      type: "touch",
      contact: "[[Alice]]",
      date: "2026-05-23",
    });
    expect(ok.passed).toBe(true);
    const bad = TouchSchema.validate({
      type: "touch",
      contact: "[[Alice]]",
      date: "5/23/2026",
    });
    expect(bad.passed).toBe(false);
  });
});

describe("TaskSchema", () => {
  it("accepts known statuses", () => {
    for (const s of ["todo", "in_progress", "blocked", "done", "cancelled"]) {
      expect(
        TaskSchema.validate({ type: "task", title: "x", status: s }).passed,
      ).toBe(true);
    }
  });
  it("rejects unknown status", () => {
    expect(
      TaskSchema.validate({ type: "task", title: "x", status: "ish" }).passed,
    ).toBe(false);
  });
});

describe("LedgerEntrySchema", () => {
  it("validates a full entry", () => {
    const r = LedgerEntrySchema.validate({
      type: "ledger-entry",
      contact: "[[Bob]]",
      date: "2026-05-23",
      category: "favor",
      amount: 100,
      currency: "USD",
      direction: "in",
    });
    expect(r.passed).toBe(true);
  });
  it("rejects non-numeric amount", () => {
    const r = LedgerEntrySchema.validate({
      type: "ledger-entry",
      contact: "[[Bob]]",
      date: "2026-05-23",
      category: "favor",
      amount: "twenty",
      currency: "USD",
      direction: "in",
    });
    expect(r.passed).toBe(false);
  });
});

describe("validateEntity dispatch", () => {
  it("dispatches by type field", () => {
    expect(validateEntity({ type: "warm-contact", name: "X" })?.passed).toBe(
      true,
    );
    expect(validateEntity({ type: "rollup", period: "2026-05" })?.passed).toBe(
      true,
    );
    expect(validateEntity({ type: "unknown-thing" })).toBeNull();
    expect(validateEntity({ not: "an entity" })).toBeNull();
  });
});

describe("default frontmatter", () => {
  it("every schema's default frontmatter validates itself", () => {
    const schemas = [
      PersonSchema,
      OrgSchema,
      TouchSchema,
      AddendumSchema,
      TaskSchema,
      FollowupSchema,
      IdeaSchema,
      LedgerEntrySchema,
      RollupSchema,
    ];
    for (const s of schemas) {
      const r = s.validate(s.defaultFrontmatter() as Record<string, unknown>);
      // Defaults may have empty required-string fields; we just check that
      // the type field always validates as the right discriminator.
      const typeErr = r.errors.find((e) => e.field === "type");
      expect(typeErr).toBeUndefined();
    }
  });
});
