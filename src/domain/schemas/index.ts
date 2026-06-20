// Schema dictionaries for every CRM entity type the plugin tracks.
// Lightweight validation — no Zod dependency, just typed predicates +
// frontmatter-mapping helpers. Each schema exposes:
//   - the EntityType union
//   - parse(fm): validates + narrows the unknown frontmatter
//   - validate(fm): returns ValidationResult (passed: boolean, errors[])
//   - defaultFrontmatter(): emits a fresh blank entity
//
// This file is the canonical anatomy of the CRM. New entity types are
// added by appending a new module under src/domain/schemas/ and
// exporting from here.

export type EntityType =
  | "warm-contact"
  | "org"
  | "subsidiary"
  | "touch"
  | "addendum"
  | "intro"
  | "relation"
  | "idea"
  | "task"
  | "followup"
  | "interaction"
  | "conversation"
  | "inbox"
  | "thread"
  | "metric"
  | "rollup"
  // Canonical CRM note types from the vault contract (CLAUDE.md v1.6.0 §2):
  | "lane"
  | "meeting"
  // CON-OBS-INTEG-001 SH-E — DEC-003 entities:
  | "playbook"
  | "template"
  | "vault"
  | "pipeline"
  | "observation"
  | "note"
  | "event";

export interface ValidationError {
  field: string;
  message: string;
  severity: "error" | "warn";
}

export interface ValidationResult {
  passed: boolean;
  errors: ValidationError[];
}

export interface EntitySchema<T extends Record<string, unknown>> {
  readonly type: EntityType;
  readonly description: string;
  defaultFrontmatter(): T;
  validate(fm: Record<string, unknown>): ValidationResult;
  parse(fm: Record<string, unknown>): T | null;
}

// ---------- shared helpers ----------

export function isString(v: unknown): v is string {
  return typeof v === "string";
}
export function isNumber(v: unknown): v is number {
  return typeof v === "number" && !Number.isNaN(v);
}
export function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === "string");
}
export function isIsoDate(v: unknown): v is string {
  return typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v);
}

function err(
  field: string,
  message: string,
  severity: "error" | "warn" = "error",
): ValidationError {
  return { field, message, severity };
}

function need(
  fm: Record<string, unknown>,
  field: string,
  check: (v: unknown) => boolean,
  msg: string,
  errs: ValidationError[],
): void {
  if (!(field in fm) || !check(fm[field])) errs.push(err(field, msg));
}

// ---------- person (warm-contact) ----------

// Canonical vault enums (CLAUDE.md v1.6.0 §3.1). Kept here as the single
// source of truth the plugin validates against; _PLUGIN-CONFIG.md mirrors it.
export const PERSON_PRIMARY_TYPES = [
  "co-founder",
  "family",
  "advisor",
  "mentor",
  "connector",
  "peer-founder",
  "community",
  "past-colleague",
] as const;
export const PERSON_ROLES = [...PERSON_PRIMARY_TYPES, "prospect"] as const;
export const CADENCES = [
  "weekly",
  "monthly",
  "quarterly",
  "bi-annual",
  "ad-hoc",
] as const;

export interface PersonFrontmatter extends Record<string, unknown> {
  type: "warm-contact";
  name: string;
  primary_type?: string;
  roles?: string[];
  closeness?: number;
  cadence?: string;
  last_touch?: string;
  location?: string;
  company?: string;
  title?: string;
  email?: string;
  phone?: string;
  linkedin?: string;
  intro_via?: string;
  intro_opt_in?: boolean;
  expertise?: string[];
  seeking?: string[];
  knows?: string[];
  worked_with?: string[];
  intro_candidates?: string[];
  family_of?: string;
  tags?: string[];
}

export const PersonSchema: EntitySchema<PersonFrontmatter> = {
  type: "warm-contact",
  description: "A warm contact in the relationship graph.",
  defaultFrontmatter: () => ({
    type: "warm-contact",
    name: "",
    primary_type: "connector",
    roles: ["connector"],
    closeness: 3,
    cadence: "quarterly",
    intro_opt_in: false,
    expertise: [],
    seeking: [],
    knows: [],
    worked_with: [],
    intro_candidates: [],
    tags: ["warm-network"],
  }),
  validate(fm) {
    const e: ValidationError[] = [];
    if (fm.type !== "warm-contact")
      e.push(err("type", `expected "warm-contact"`));
    need(fm, "name", isString, "name must be a non-empty string", e);
    if (fm.name === "") e.push(err("name", "name must be non-empty"));
    // Canonical required fields (§2.1). Empty list/scalar permitted (§2).
    if ("primary_type" in fm && !isString(fm.primary_type))
      e.push(err("primary_type", "primary_type must be a string", "warn"));
    if ("closeness" in fm && fm.closeness != null) {
      const c = Number(fm.closeness);
      if (!Number.isInteger(c) || c < 1 || c > 5)
        e.push(err("closeness", "closeness must be 1..5", "warn"));
    }
    if ("cadence" in fm && fm.cadence != null && !isString(fm.cadence))
      e.push(err("cadence", "cadence must be a string", "warn"));
    if ("intro_opt_in" in fm && typeof fm.intro_opt_in !== "boolean")
      e.push(err("intro_opt_in", "intro_opt_in must be boolean", "warn"));
    for (const arr of [
      "roles",
      "expertise",
      "seeking",
      "knows",
      "worked_with",
      "intro_candidates",
    ] as const) {
      if (arr in fm && !isStringArray(fm[arr]))
        e.push(err(arr, `${arr} must be string[]`));
    }
    if ("last_touch" in fm && fm.last_touch && !isIsoDate(fm.last_touch))
      e.push(err("last_touch", "must be ISO date", "warn"));
    return {
      passed: e.filter((x) => x.severity === "error").length === 0,
      errors: e,
    };
  },
  parse(fm) {
    const r = this.validate(fm);
    if (!r.passed) return null;
    return fm as PersonFrontmatter;
  },
};

// ---------- org ----------

export const ORG_STATUSES = [
  "active",
  "customer",
  "vendor",
  "competitor",
  "defunct",
  "prospect",
] as const;

export interface OrgFrontmatter extends Record<string, unknown> {
  type: "org" | "subsidiary";
  name: string;
  primary_type?: string;
  status?: string;
  industry?: string;
  location?: string;
  website?: string;
  tags?: string[];
  parent?: string;
}

export const OrgSchema: EntitySchema<OrgFrontmatter> = {
  type: "org",
  description: "An organization in the relationship graph.",
  defaultFrontmatter: () => ({
    type: "org",
    name: "",
    primary_type: "org",
    status: "active",
    tags: ["org"],
  }),
  validate(fm) {
    const e: ValidationError[] = [];
    if (fm.type !== "org" && fm.type !== "subsidiary")
      e.push(err("type", `expected "org" or "subsidiary"`));
    need(fm, "name", isString, "name must be a non-empty string", e);
    return {
      passed: e.filter((x) => x.severity === "error").length === 0,
      errors: e,
    };
  },
  parse(fm) {
    const r = this.validate(fm);
    if (!r.passed) return null;
    return fm as OrgFrontmatter;
  },
};

// ---------- touch ----------

export const CHANNELS = [
  "in-person",
  "call",
  "text",
  "dinner",
  "email",
  "event",
] as const;
export const OUTCOME_TAGS = [
  "update-given",
  "advice-received",
  "intro-offered",
  "intro-made",
  "asked-for-intro",
] as const;

export interface TouchFrontmatter extends Record<string, unknown> {
  type: "touch";
  contact: string;
  date: string;
  channel?: string;
  playbook_used?: string;
  outcome_tags?: string[];
  referral_to?: string;
  attendees?: string[];
  source?: string;
}

export const TouchSchema: EntitySchema<TouchFrontmatter> = {
  type: "touch",
  description:
    "A single conversation/interaction event with a contact (immutable).",
  defaultFrontmatter: () => ({
    type: "touch",
    contact: "",
    date: new Date().toISOString().slice(0, 10),
    channel: "call",
    playbook_used: "",
    outcome_tags: [],
    attendees: [],
  }),
  validate(fm) {
    const e: ValidationError[] = [];
    if (fm.type !== "touch") e.push(err("type", `expected "touch"`));
    need(fm, "contact", isString, "contact must be a wikilink-string", e);
    need(fm, "date", isIsoDate, "date must be ISO YYYY-MM-DD", e);
    if ("outcome_tags" in fm && !isStringArray(fm.outcome_tags))
      e.push(err("outcome_tags", "outcome_tags must be string[]"));
    if ("attendees" in fm && !isStringArray(fm.attendees))
      e.push(err("attendees", "attendees must be string[]"));
    return {
      passed: e.filter((x) => x.severity === "error").length === 0,
      errors: e,
    };
  },
  parse(fm) {
    const r = this.validate(fm);
    if (!r.passed) return null;
    return fm as TouchFrontmatter;
  },
};

// ---------- addendum ----------

export interface AddendumFrontmatter extends Record<string, unknown> {
  type: "addendum";
  addends: string;
  kind: string;
  date: string;
}

export const AddendumSchema: EntitySchema<AddendumFrontmatter> = {
  type: "addendum",
  description: "An immutable correction/enrichment attached to another entity.",
  defaultFrontmatter: () => ({
    type: "addendum",
    addends: "",
    kind: "correction",
    date: new Date().toISOString().slice(0, 10),
  }),
  validate(fm) {
    const e: ValidationError[] = [];
    if (fm.type !== "addendum") e.push(err("type", `expected "addendum"`));
    need(
      fm,
      "addends",
      isString,
      "addends must be the wikilink of the target",
      e,
    );
    need(fm, "kind", isString, "kind must be one of the addendum kinds", e);
    need(fm, "date", isIsoDate, "date must be ISO YYYY-MM-DD", e);
    return {
      passed: e.filter((x) => x.severity === "error").length === 0,
      errors: e,
    };
  },
  parse(fm) {
    const r = this.validate(fm);
    if (!r.passed) return null;
    return fm as AddendumFrontmatter;
  },
};

// ---------- task ----------

export interface TaskFrontmatter extends Record<string, unknown> {
  type: "task";
  title: string;
  status: "todo" | "in_progress" | "blocked" | "done" | "cancelled";
  contact?: string;
  due?: string;
  priority?: "low" | "medium" | "high" | "urgent";
  tags?: string[];
  blocked_by?: string[];
  /** Skill to invoke when this task fires (S3/S5). */
  skill_id?: string;
  /** JSON-serializable arguments forwarded to the skill. */
  skill_args?: Record<string, unknown>;
  /** Trigger schedule: "manual" | "interval:<SyncFrequency>" | "cron:<5-field-expr>" */
  schedule?: string;
  /** ISO-8601 timestamp of the last successful skill run. */
  last_run?: string;
  /** ISO-8601 timestamp of the next scheduled skill run. */
  next_run?: string;
  /** Autonomy level override for scheduled runs of this task's skill. */
  autonomy?: "propose" | "confirm-each" | "confirm-bulk" | "autonomous";
}

export const TaskSchema: EntitySchema<TaskFrontmatter> = {
  type: "task",
  description: "An actionable item, optionally linked to a contact/org.",
  defaultFrontmatter: () => ({ type: "task", title: "", status: "todo" }),
  validate(fm) {
    const e: ValidationError[] = [];
    if (fm.type !== "task") e.push(err("type", `expected "task"`));
    need(fm, "title", isString, "title must be a string", e);
    if (
      !["todo", "in_progress", "blocked", "done", "cancelled"].includes(
        String(fm.status),
      )
    ) {
      e.push(err("status", "status must be a known value"));
    }
    if ("due" in fm && !isIsoDate(fm.due))
      e.push(err("due", "due must be ISO date", "warn"));
    return {
      passed: e.filter((x) => x.severity === "error").length === 0,
      errors: e,
    };
  },
  parse(fm) {
    const r = this.validate(fm);
    if (!r.passed) return null;
    return fm as TaskFrontmatter;
  },
};

// ---------- followup ----------

export interface FollowupFrontmatter extends Record<string, unknown> {
  type: "followup";
  trigger: string;
  contact: string;
  due: string;
  notes?: string;
  status: "pending" | "done" | "skipped";
}

export const FollowupSchema: EntitySchema<FollowupFrontmatter> = {
  type: "followup",
  description: "A scheduled follow-up reminder for a contact.",
  defaultFrontmatter: () => ({
    type: "followup",
    trigger: "manual",
    contact: "",
    due: new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10),
    status: "pending",
  }),
  validate(fm) {
    const e: ValidationError[] = [];
    if (fm.type !== "followup") e.push(err("type", `expected "followup"`));
    need(fm, "contact", isString, "contact must be a wikilink", e);
    need(fm, "due", isIsoDate, "due must be ISO date", e);
    if (!["pending", "done", "skipped"].includes(String(fm.status)))
      e.push(err("status", "unknown status"));
    return {
      passed: e.filter((x) => x.severity === "error").length === 0,
      errors: e,
    };
  },
  parse(fm) {
    const r = this.validate(fm);
    if (!r.passed) return null;
    return fm as FollowupFrontmatter;
  },
};

// ---------- idea ----------

export const IDEA_STAGES = [
  "seed",
  "shaping",
  "planned",
  "active",
  "shipped",
  "archived",
] as const;
export const IMPACTS = ["low", "medium", "high"] as const;

export interface IdeaFrontmatter extends Record<string, unknown> {
  type: "idea";
  title: string;
  stage: string;
  impact?: string;
  next_action?: string;
  contact?: string;
  org?: string;
  date?: string;
  author?: string;
  tags?: string[];
}

export const IdeaSchema: EntitySchema<IdeaFrontmatter> = {
  type: "idea",
  description: "A captured idea / opportunity thesis (CLAUDE.md §2.10).",
  defaultFrontmatter: () => ({
    type: "idea",
    title: "",
    stage: "seed",
    date: new Date().toISOString().slice(0, 10),
    tags: ["idea"],
  }),
  validate(fm) {
    const e: ValidationError[] = [];
    if (fm.type !== "idea") e.push(err("type", `expected "idea"`));
    need(fm, "title", isString, "title must be a string", e);
    if (!(IDEA_STAGES as readonly string[]).includes(String(fm.stage)))
      e.push(err("stage", "stage must be a known idea_stage"));
    if (
      "impact" in fm &&
      fm.impact != null &&
      !(IMPACTS as readonly string[]).includes(String(fm.impact))
    )
      e.push(err("impact", "impact must be low|medium|high", "warn"));
    return {
      passed: e.filter((x) => x.severity === "error").length === 0,
      errors: e,
    };
  },
  parse(fm) {
    const r = this.validate(fm);
    if (!r.passed) return null;
    return fm as IdeaFrontmatter;
  },
};

// ---------- lane (CLAUDE.md §2.6) ----------

export const LANE_AXES = ["experience", "expertise"] as const;
export const LANE_STATUSES = ["active", "exploratory", "dormant"] as const;

export interface LaneFrontmatter extends Record<string, unknown> {
  type: "lane";
  owner: string;
  lane_axis: string;
  primary_domain: string;
  domain_tags?: string[];
  status: string;
  partner_orgs?: string[];
  prospect_orgs?: string[];
  communities?: string[];
  related_lanes?: string[];
  tags?: string[];
}

export const LaneSchema: EntitySchema<LaneFrontmatter> = {
  type: "lane",
  description:
    "A curated MOC aggregating people/orgs/threads for an operator-domain pairing.",
  defaultFrontmatter: () => ({
    type: "lane",
    owner: "",
    lane_axis: "expertise",
    primary_domain: "",
    domain_tags: [],
    status: "exploratory",
    partner_orgs: [],
    prospect_orgs: [],
    communities: [],
    related_lanes: [],
    tags: ["lane"],
  }),
  validate(fm) {
    const e: ValidationError[] = [];
    if (fm.type !== "lane") e.push(err("type", `expected "lane"`));
    need(fm, "owner", isString, "owner must be a [[Person]] wikilink", e);
    need(fm, "primary_domain", isString, "primary_domain must be a tag", e);
    if (!(LANE_AXES as readonly string[]).includes(String(fm.lane_axis)))
      e.push(err("lane_axis", "lane_axis must be experience|expertise"));
    if (!(LANE_STATUSES as readonly string[]).includes(String(fm.status)))
      e.push(err("status", "status must be active|exploratory|dormant"));
    return {
      passed: e.filter((x) => x.severity === "error").length === 0,
      errors: e,
    };
  },
  parse(fm) {
    const r = this.validate(fm);
    if (!r.passed) return null;
    return fm as LaneFrontmatter;
  },
};

// ---------- meeting (CLAUDE.md §2.8) ----------

export const MEETING_KINDS = ["held", "prep", "agenda"] as const;

export interface MeetingFrontmatter extends Record<string, unknown> {
  type: "meeting";
  date: string;
  attendees?: string[];
  org?: string;
  kind?: string;
  outcome?: string;
  related_touch?: string;
  tags?: string[];
}

export const MeetingSchema: EntitySchema<MeetingFrontmatter> = {
  type: "meeting",
  description: "A working record/agenda/outcome of a convening (CLAUDE.md §2.8).",
  defaultFrontmatter: () => ({
    type: "meeting",
    date: new Date().toISOString().slice(0, 10),
    attendees: [],
    kind: "held",
    tags: ["meeting"],
  }),
  validate(fm) {
    const e: ValidationError[] = [];
    if (fm.type !== "meeting") e.push(err("type", `expected "meeting"`));
    need(fm, "date", isIsoDate, "date must be ISO YYYY-MM-DD", e);
    if ("attendees" in fm && !isStringArray(fm.attendees))
      e.push(err("attendees", "attendees must be string[]"));
    if (
      "kind" in fm &&
      fm.kind != null &&
      !(MEETING_KINDS as readonly string[]).includes(String(fm.kind))
    )
      e.push(err("kind", "kind must be held|prep|agenda", "warn"));
    return {
      passed: e.filter((x) => x.severity === "error").length === 0,
      errors: e,
    };
  },
  parse(fm) {
    const r = this.validate(fm);
    if (!r.passed) return null;
    return fm as MeetingFrontmatter;
  },
};

// ---------- rollup ----------

export interface RollupFrontmatter extends Record<string, unknown> {
  type: "rollup";
  period: string;
  scope: string;
  metrics: Record<string, number>;
}

export const RollupSchema: EntitySchema<RollupFrontmatter> = {
  type: "rollup",
  description: "Periodic aggregate metrics (weekly/monthly/quarterly).",
  defaultFrontmatter: () => ({
    type: "rollup",
    period: new Date().toISOString().slice(0, 7),
    scope: "all",
    metrics: {},
  }),
  validate(fm) {
    const e: ValidationError[] = [];
    if (fm.type !== "rollup") e.push(err("type", `expected "rollup"`));
    need(
      fm,
      "period",
      isString,
      "period must be a string like YYYY-MM or YYYY-Q1",
      e,
    );
    return {
      passed: e.filter((x) => x.severity === "error").length === 0,
      errors: e,
    };
  },
  parse(fm) {
    const r = this.validate(fm);
    if (!r.passed) return null;
    return fm as RollupFrontmatter;
  },
};

// ---------- registry ----------

// CON-OBS-INTEG-001 SH-E (T-E-01): the 7 genuinely-new DEC-003 entities. The
// other 7 (people/orgs/touches/addenda/tasks/ideas/ledger) are already covered
// by the schemas above — reconciled, not duplicated (CONFLICT-3). Imports are
// hoisted; the type-guard fns these modules import from here are hoisted
// function declarations, so the cycle resolves cleanly.
import { PlaybookSchema } from "./playbooks";
import { TemplateSchema } from "./templates";
import { VaultSchema } from "./vaults";
import { PipelineSchema } from "./pipelines";
import { ObservationSchema } from "./observations";
import { NoteSchema } from "./notes";
import { EventSchema } from "./events";

export { PlaybookSchema } from "./playbooks";
export { TemplateSchema } from "./templates";
export { VaultSchema } from "./vaults";
export { PipelineSchema } from "./pipelines";
export { ObservationSchema } from "./observations";
export { NoteSchema } from "./notes";
export { EventSchema } from "./events";
export type { PlaybookFrontmatter } from "./playbooks";
export type { TemplateFrontmatter } from "./templates";
export type { VaultFrontmatter } from "./vaults";
export type { PipelineFrontmatter } from "./pipelines";
export type { ObservationFrontmatter } from "./observations";
export type { NoteFrontmatter } from "./notes";
export type { EventFrontmatter } from "./events";

export const ENTITY_SCHEMAS = {
  "warm-contact": PersonSchema,
  org: OrgSchema,
  touch: TouchSchema,
  addendum: AddendumSchema,
  task: TaskSchema,
  followup: FollowupSchema,
  idea: IdeaSchema,
  lane: LaneSchema,
  meeting: MeetingSchema,
  rollup: RollupSchema,
  // DEC-003 new entities (SH-E):
  playbook: PlaybookSchema,
  template: TemplateSchema,
  vault: VaultSchema,
  pipeline: PipelineSchema,
  observation: ObservationSchema,
  note: NoteSchema,
  event: EventSchema,
} as const;

/** Dispatch validation by the frontmatter's `type` field. Returns null
 *  if the type is unknown — that's a "not a sauce entity" signal. */
export function validateEntity(
  fm: Record<string, unknown>,
): ValidationResult | null {
  const t = fm.type;
  if (typeof t !== "string") return null;
  const schema = (
    ENTITY_SCHEMAS as Record<string, EntitySchema<Record<string, unknown>>>
  )[t];
  if (!schema) return null;
  return schema.validate(fm);
}
