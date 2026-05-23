// CON-OBS-INTEG-001 · T-E-01 · ENT-templates — predicate schema (no Zod).

import {
  type EntitySchema,
  type ValidationError,
  isString,
  isStringArray,
} from "./index";

export interface TemplateFrontmatter extends Record<string, unknown> {
  type: "template";
  entityType: string;
  fields_schema?: string;
  body_template?: string;
  markers?: string[];
  canonized?: boolean;
}

export const TemplateSchema: EntitySchema<TemplateFrontmatter> = {
  type: "template",
  description: "A reusable entity template (field schema + body markers).",
  defaultFrontmatter: () => ({ type: "template", entityType: "", markers: [] }),
  validate(fm) {
    const e: ValidationError[] = [];
    if (fm.type !== "template")
      e.push({
        field: "type",
        message: 'expected "template"',
        severity: "error",
      });
    if (!isString(fm.entityType))
      e.push({
        field: "entityType",
        message: "entityType must be a string",
        severity: "error",
      });
    if ("markers" in fm && !isStringArray(fm.markers))
      e.push({
        field: "markers",
        message: "markers must be string[]",
        severity: "error",
      });
    return {
      passed: e.filter((x) => x.severity === "error").length === 0,
      errors: e,
    };
  },
  parse(fm) {
    return this.validate(fm).passed ? (fm as TemplateFrontmatter) : null;
  },
};
