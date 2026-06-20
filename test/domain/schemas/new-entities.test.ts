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
  LaneSchema,
  MeetingSchema,
} from "../../../src/domain/schemas/index";

describe("canonical entity surface (CLAUDE.md v1.6.0)", () => {
  it("registers the canonical CRM entity types", () => {
    const types = Object.keys(ENTITY_SCHEMAS);
    for (const t of [
      "warm-contact",
      "org",
      "touch",
      "addendum",
      "task",
      "idea",
      "lane", // canonical §2.6
      "meeting", // canonical §2.8
      "playbook",
      "template",
      "vault",
      "pipeline",
      "observation",
      "note",
      "event",
    ]) {
      expect(types).toContain(t);
    }
  });

  it("no longer registers the purged financial ledger type", () => {
    expect(Object.keys(ENTITY_SCHEMAS)).not.toContain("ledger-entry");
    expect(validateEntity({ type: "ledger-entry", amount: 1 })).toBeNull();
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
        observation_kind: "connecting-organization",
        name: "CXPA",
      }).passed,
    ).toBe(true);
    expect(
      ObservationSchema.validate({
        type: "observation",
        observation_kind: "not-a-kind",
      }).passed,
    ).toBe(false);
    expect(NoteSchema.validate({ type: "note", title: "N" }).passed).toBe(true);
    expect(
      EventSchema.validate({
        type: "event",
        title: "Chamber meeting",
        date: "2026-07-08",
      }).passed,
    ).toBe(true);
    expect(
      EventSchema.validate({ type: "event", title: "x", date: "nope" }).passed,
    ).toBe(false);
  });

  it("validates the canonical lane and meeting types", () => {
    expect(
      LaneSchema.validate({
        type: "lane",
        owner: "[[Malcolm Sullivan]]",
        lane_axis: "experience",
        primary_domain: "commercial-real-estate",
        status: "active",
      }).passed,
    ).toBe(true);
    expect(
      LaneSchema.validate({
        type: "lane",
        owner: "[[X]]",
        lane_axis: "bogus",
        primary_domain: "x",
        status: "active",
      }).passed,
    ).toBe(false);
    expect(
      MeetingSchema.validate({
        type: "meeting",
        date: "2026-05-24",
        attendees: ["[[Bob Lambert]]"],
        kind: "prep",
      }).passed,
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
