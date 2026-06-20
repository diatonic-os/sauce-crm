// Canonical "connecting node" observation (CLAUDE.md v1.6.0 §2.13): a node we
// want to SEE in the graph but are not targeting — a connecting organization,
// connecting person, or standing analysis. Matches the live Observation domain
// class. The previous timestamped-claim shape (subjectId/claim/confidence) was
// dead schema — nothing wrote it.

import {
  type EntitySchema,
  type ValidationError,
  isStringArray,
} from "./index";

export const OBSERVATION_KINDS = [
  "connecting-organization",
  "connecting-person",
  "analysis",
] as const;
export const OBSERVATION_SIGNALS = [
  "relationship",
  "opportunity",
  "risk",
  "timing",
  "access",
  "pattern",
] as const;

export interface ObservationFrontmatter extends Record<string, unknown> {
  type: "observation";
  observation_kind: string;
  name?: string;
  connects?: string[];
  observation_signal?: string;
  tags?: string[];
}

export const ObservationSchema: EntitySchema<ObservationFrontmatter> = {
  type: "observation",
  description:
    "A non-target connecting node / analysis (CLAUDE.md §2.13).",
  defaultFrontmatter: () => ({
    type: "observation",
    observation_kind: "connecting-organization",
    name: "",
    connects: [],
    tags: ["observation"],
  }),
  validate(fm) {
    const e: ValidationError[] = [];
    if (fm.type !== "observation")
      e.push({
        field: "type",
        message: 'expected "observation"',
        severity: "error",
      });
    if (
      !(OBSERVATION_KINDS as readonly string[]).includes(
        String(fm.observation_kind),
      )
    )
      e.push({
        field: "observation_kind",
        message:
          "observation_kind must be connecting-organization|connecting-person|analysis",
        severity: "error",
      });
    if ("connects" in fm && !isStringArray(fm.connects))
      e.push({
        field: "connects",
        message: "connects must be string[]",
        severity: "error",
      });
    if (
      "observation_signal" in fm &&
      fm.observation_signal != null &&
      !(OBSERVATION_SIGNALS as readonly string[]).includes(
        String(fm.observation_signal),
      )
    )
      e.push({
        field: "observation_signal",
        message: "observation_signal must be a known signal",
        severity: "warn",
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
