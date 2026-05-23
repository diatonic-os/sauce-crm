// CON-OBS-INTEG-001 · T-E-01 · ENT-notes — predicate schema (no Zod).

import {
  type EntitySchema,
  type ValidationError,
  isString,
  isStringArray,
} from "./index";

export interface NoteFrontmatter extends Record<string, unknown> {
  type: "note";
  title: string;
  body?: string;
  linkedIds?: string[];
  tags?: string[];
  canonized?: boolean;
}

export const NoteSchema: EntitySchema<NoteFrontmatter> = {
  type: "note",
  description: "A free-standing note linked into the graph.",
  defaultFrontmatter: () => ({
    type: "note",
    title: "",
    linkedIds: [],
    tags: [],
  }),
  validate(fm) {
    const e: ValidationError[] = [];
    if (fm.type !== "note")
      e.push({ field: "type", message: 'expected "note"', severity: "error" });
    if (!isString(fm.title))
      e.push({
        field: "title",
        message: "title must be a string",
        severity: "error",
      });
    for (const k of ["linkedIds", "tags"] as const) {
      if (k in fm && !isStringArray(fm[k]))
        e.push({
          field: k,
          message: `${k} must be string[]`,
          severity: "error",
        });
    }
    return {
      passed: e.filter((x) => x.severity === "error").length === 0,
      errors: e,
    };
  },
  parse(fm) {
    return this.validate(fm).passed ? (fm as NoteFrontmatter) : null;
  },
};
