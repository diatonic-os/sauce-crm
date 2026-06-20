// Canonical calendar event (CLAUDE.md v1.6.0 §2.9). Matches the live
// EventEntity domain class (title/date/start/end/attendees). The previous
// event-sourcing shape (eventType/payload_json) was dead schema — nothing
// wrote it; MutationContract's ev-<ulid> ContractEvent is in-memory only.

import {
  type EntitySchema,
  type ValidationError,
  isString,
  isStringArray,
  isIsoDate,
} from "./index";

export interface EventFrontmatter extends Record<string, unknown> {
  type: "event";
  title: string;
  date: string;
  start?: string;
  end?: string;
  location?: string;
  contact?: string;
  org?: string;
  attendees?: string[];
  tags?: string[];
}

export const EventSchema: EntitySchema<EventFrontmatter> = {
  type: "event",
  description: "A calendared event (CLAUDE.md §2.9).",
  defaultFrontmatter: () => ({
    type: "event",
    title: "",
    date: new Date().toISOString().slice(0, 10),
    tags: ["event"],
  }),
  validate(fm) {
    const e: ValidationError[] = [];
    if (fm.type !== "event")
      e.push({ field: "type", message: 'expected "event"', severity: "error" });
    if (!isString(fm.title))
      e.push({
        field: "title",
        message: "title must be a string",
        severity: "error",
      });
    if (!isIsoDate(fm.date))
      e.push({
        field: "date",
        message: "date must be ISO YYYY-MM-DD",
        severity: "error",
      });
    if ("attendees" in fm && !isStringArray(fm.attendees))
      e.push({
        field: "attendees",
        message: "attendees must be string[]",
        severity: "error",
      });
    return {
      passed: e.filter((x) => x.severity === "error").length === 0,
      errors: e,
    };
  },
  parse(fm) {
    return this.validate(fm).passed ? (fm as EventFrontmatter) : null;
  },
};
