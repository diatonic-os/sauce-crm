// CON-OBS-INTEG-001 · T-E-01 · ENT-pipelines — predicate schema (no Zod).
// Projected from kanban boards (INT-kanban) → pl-<ulid> graph nodes.

import {
  type EntitySchema,
  type ValidationError,
  isString,
  isStringArray,
} from "./index";

export interface PipelineFrontmatter extends Record<string, unknown> {
  type: "pipeline";
  name: string;
  stages?: string[];
  entryEntity?: string;
  exitEntity?: string;
  slas?: string[];
  kanbanBoardId?: string;
  canonized?: boolean;
}

export const PipelineSchema: EntitySchema<PipelineFrontmatter> = {
  type: "pipeline",
  description: "A staged workflow (often projected from a kanban board).",
  defaultFrontmatter: () => ({
    type: "pipeline",
    name: "",
    stages: [],
    slas: [],
  }),
  validate(fm) {
    const e: ValidationError[] = [];
    if (fm.type !== "pipeline")
      e.push({
        field: "type",
        message: 'expected "pipeline"',
        severity: "error",
      });
    if (!isString(fm.name))
      e.push({
        field: "name",
        message: "name must be a string",
        severity: "error",
      });
    for (const k of ["stages", "slas"] as const) {
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
    return this.validate(fm).passed ? (fm as PipelineFrontmatter) : null;
  },
};
