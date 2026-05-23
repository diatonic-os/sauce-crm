// CON-OBS-INTEG-001 · T-E-01 · ENT-observations — predicate schema (no Zod).

import {
  type EntitySchema,
  type ValidationError,
  isString,
  isNumber,
  isStringArray,
  isIsoDate,
} from "./index";

export interface ObservationFrontmatter extends Record<string, unknown> {
  type: "observation";
  ts: string;
  subjectId: string;
  claim: string;
  evidence?: string[];
  confidence?: number;
  sourceIntegrationId?: string;
  canonized?: boolean;
}

export const ObservationSchema: EntitySchema<ObservationFrontmatter> = {
  type: "observation",
  description:
    "A timestamped claim about a subject, with evidence + confidence.",
  defaultFrontmatter: () => ({
    type: "observation",
    ts: new Date().toISOString(),
    subjectId: "",
    claim: "",
    evidence: [],
  }),
  validate(fm) {
    const e: ValidationError[] = [];
    if (fm.type !== "observation")
      e.push({
        field: "type",
        message: 'expected "observation"',
        severity: "error",
      });
    if (!isString(fm.subjectId))
      e.push({
        field: "subjectId",
        message: "subjectId must be a wikilink/id",
        severity: "error",
      });
    if (!isString(fm.claim))
      e.push({
        field: "claim",
        message: "claim must be a string",
        severity: "error",
      });
    if ("ts" in fm && !isIsoDate(fm.ts))
      e.push({ field: "ts", message: "ts must be ISO", severity: "warn" });
    if ("evidence" in fm && !isStringArray(fm.evidence))
      e.push({
        field: "evidence",
        message: "evidence must be string[]",
        severity: "error",
      });
    if ("confidence" in fm && !isNumber(fm.confidence))
      e.push({
        field: "confidence",
        message: "confidence must be a number",
        severity: "error",
      });
    return {
      passed: e.filter((x) => x.severity === "error").length === 0,
      errors: e,
    };
  },
  parse(fm) {
    return this.validate(fm).passed ? (fm as ObservationFrontmatter) : null;
  },
};
