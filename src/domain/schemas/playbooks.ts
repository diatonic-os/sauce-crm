// CON-OBS-INTEG-001 · T-E-01 · ENT-playbooks — predicate schema (no Zod, matches
// the existing src/domain/schemas/index.ts EntitySchema<T> style).

import {
  type EntitySchema,
  type ValidationError,
  isString,
  isStringArray,
} from "./index";

export interface PlaybookFrontmatter extends Record<string, unknown> {
  type: "playbook";
  title: string;
  steps?: string[];
  triggers?: string[];
  outcomes?: string[];
  tags?: string[];
  canonized?: boolean;
}

export const PlaybookSchema: EntitySchema<PlaybookFrontmatter> = {
  type: "playbook",
  description: "A repeatable sequence of steps with triggers and outcomes.",
  defaultFrontmatter: () => ({
    type: "playbook",
    title: "",
    steps: [],
    triggers: [],
    outcomes: [],
    tags: [],
  }),
  validate(fm) {
    const e: ValidationError[] = [];
    if (fm.type !== "playbook")
      e.push({
        field: "type",
        message: 'expected "playbook"',
        severity: "error",
      });
    if (!isString(fm.name) && !isString(fm.title))
      e.push({
        field: "title",
        message: "title must be a string",
        severity: "error",
      });
    for (const k of ["steps", "triggers", "outcomes", "tags"] as const) {
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
    return this.validate(fm).passed ? (fm as PlaybookFrontmatter) : null;
  },
};
