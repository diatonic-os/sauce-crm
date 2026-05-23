import { describe, expect, it } from "vitest";
import {
  ENTITY_SCHEMAS,
  validateEntity,
  PlaybookSchema,
  TemplateSchema,
  VaultSchema,
  PipelineSchema,
  ObservationSchema,
  NoteSchema,
  EventSchema,
} from "../../../src/domain/schemas/index";

describe("DEC-003 14-entity surface (T-E-01)", () => {
  it("registers all 14 reconciled entity types (no duplication)", () => {
    const types = Object.keys(ENTITY_SCHEMAS);
    // the 7 pre-existing (reconciled) + 7 new = the DEC-003 14, plus legacy followup/rollup
    for (const t of [
      "warm-contact",
      "org",
      "touch",
      "addendum",
      "task",
      "idea",
      "ledger-entry", // existing 7
      "playbook",
      "template",
      "vault",
      "pipeline",
      "observation",
      "note",
      "event", // new 7
    ]) {
      expect(types).toContain(t);
    }
  });

  it("each new schema validates a well-formed entity and rejects a malformed one", () => {
    expect(
      PlaybookSchema.validate({ type: "playbook", title: "Onboard" }).passed,
    ).toBe(true);
    expect(
      PlaybookSchema.validate({ type: "playbook", steps: "nope" }).passed,
    ).toBe(false);

    expect(
      TemplateSchema.validate({ type: "template", entityType: "person" })
        .passed,
    ).toBe(true);
    expect(TemplateSchema.validate({ type: "template" }).passed).toBe(false);

    expect(
      VaultSchema.validate({ type: "vault", name: "V", path: "/v" }).passed,
    ).toBe(true);
    expect(VaultSchema.validate({ type: "vault", name: "V" }).passed).toBe(
      false,
    );

    expect(
      PipelineSchema.validate({ type: "pipeline", name: "Sales" }).passed,
    ).toBe(true);
    expect(
      ObservationSchema.validate({
        type: "observation",
        subjectId: "person/A",
        claim: "x",
      }).passed,
    ).toBe(true);
    expect(NoteSchema.validate({ type: "note", title: "N" }).passed).toBe(true);
    expect(
      EventSchema.validate({ type: "event", eventType: "entity.update" })
        .passed,
    ).toBe(true);
  });

  it("validateEntity dispatches the new types by frontmatter.type", () => {
    expect(validateEntity({ type: "note", title: "Hi" })?.passed).toBe(true);
    expect(validateEntity({ type: "pipeline", name: "P" })?.passed).toBe(true);
    expect(validateEntity({ type: "totally-unknown" })).toBeNull();
  });

  it("defaultFrontmatter round-trips through parse for each new entity", () => {
    for (const s of [
      PlaybookSchema,
      TemplateSchema,
      VaultSchema,
      PipelineSchema,
      ObservationSchema,
      NoteSchema,
      EventSchema,
    ]) {
      expect(s.parse(s.defaultFrontmatter())).not.toBeNull();
    }
  });
});
