// CON-OBS-INTEG-001 · T-E-01 · ENT-events — predicate schema (no Zod).
// Emitted by the MutationContract (ev-<ulid>) and other sources.

import {
  type EntitySchema,
  type ValidationError,
  isString,
  isIsoDate,
} from "./index";

export interface EventFrontmatter extends Record<string, unknown> {
  type: "event";
  ts: string;
  eventType: string;
  payload_json?: string;
  emittedBy?: string;
  correlationId?: string;
  canonized?: boolean;
}

export const EventSchema: EntitySchema<EventFrontmatter> = {
  type: "event",
  description: "A domain event (mutation, sync, integration signal).",
  defaultFrontmatter: () => ({
    type: "event",
    ts: new Date().toISOString(),
    eventType: "",
  }),
  validate(fm) {
    const e: ValidationError[] = [];
    if (fm.type !== "event")
      e.push({ field: "type", message: 'expected "event"', severity: "error" });
    if (!isString(fm.eventType))
      e.push({
        field: "eventType",
        message: "eventType must be a string",
        severity: "error",
      });
    if ("ts" in fm && !isIsoDate(fm.ts))
      e.push({ field: "ts", message: "ts must be ISO", severity: "warn" });
    return {
      passed: e.filter((x) => x.severity === "error").length === 0,
      errors: e,
    };
  },
  parse(fm) {
    return this.validate(fm).passed ? (fm as EventFrontmatter) : null;
  },
};
