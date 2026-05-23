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
  | "ledger-entry"
  | "metric"
  | "rollup";

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

function err(field: string, message: string, severity: "error" | "warn" = "error"): ValidationError {
  return { field, message, severity };
}

function need(fm: Record<string, unknown>, field: string, check: (v: unknown) => boolean, msg: string, errs: ValidationError[]): void {
  if (!(field in fm) || !check(fm[field])) errs.push(err(field, msg));
}

// ---------- person (warm-contact) ----------

export interface PersonFrontmatter extends Record<string, unknown> {
  type: "warm-contact";
  name: string;
  primary_type?: string;
  roles?: string[];
  cadence?: string;
  last_touch?: string;
  tags?: string[];
  knows?: string[];
  worked_with?: string[];
  intro_via?: string[];
  family_of?: string[];
  company?: string;
}

export const PersonSchema: EntitySchema<PersonFrontmatter> = {
  type: "warm-contact",
  description: "A warm contact in the relationship graph.",
  defaultFrontmatter: () => ({
    type: "warm-contact",
    name: "",
    roles: [],
    tags: [],
  }),
  validate(fm) {
    const e: ValidationError[] = [];
    if (fm.type !== "warm-contact") e.push(err("type", `expected "warm-contact"`));
    need(fm, "name", isString, "name must be a non-empty string", e);
    if (fm.name === "") e.push(err("name", "name must be non-empty"));
    if ("roles" in fm && !isStringArray(fm.roles)) e.push(err("roles", "roles must be string[]"));
    if ("last_touch" in fm && !isIsoDate(fm.last_touch)) e.push(err("last_touch", "must be ISO date", "warn"));
    return { passed: e.filter((x) => x.severity === "error").length === 0, errors: e };
  },
  parse(fm) {
    const r = this.validate(fm);
    if (!r.passed) return null;
    return fm as PersonFrontmatter;
  },
};

// ---------- org ----------

export interface OrgFrontmatter extends Record<string, unknown> {
  type: "org" | "subsidiary";
  name: string;
  status?: string;
  industry?: string;
  location?: string;
  tags?: string[];
  parent?: string;
}

export const OrgSchema: EntitySchema<OrgFrontmatter> = {
  type: "org",
  description: "An organization in the relationship graph.",
  defaultFrontmatter: () => ({ type: "org", name: "", tags: [] }),
  validate(fm) {
    const e: ValidationError[] = [];
    if (fm.type !== "org" && fm.type !== "subsidiary") e.push(err("type", `expected "org" or "subsidiary"`));
    need(fm, "name", isString, "name must be a non-empty string", e);
    return { passed: e.filter((x) => x.severity === "error").length === 0, errors: e };
  },
  parse(fm) {
    const r = this.validate(fm);
    if (!r.passed) return null;
    return fm as OrgFrontmatter;
  },
};

// ---------- touch ----------

export interface TouchFrontmatter extends Record<string, unknown> {
  type: "touch";
  contact: string;
  date: string;
  channel?: string;
  outcome_tag?: string[];
  notes?: string;
}

export const TouchSchema: EntitySchema<TouchFrontmatter> = {
  type: "touch",
  description: "A single conversation/interaction event with a contact (immutable).",
  defaultFrontmatter: () => ({
    type: "touch",
    contact: "",
    date: new Date().toISOString().slice(0, 10),
  }),
  validate(fm) {
    const e: ValidationError[] = [];
    if (fm.type !== "touch") e.push(err("type", `expected "touch"`));
    need(fm, "contact", isString, "contact must be a wikilink-string", e);
    need(fm, "date", isIsoDate, "date must be ISO YYYY-MM-DD", e);
    return { passed: e.filter((x) => x.severity === "error").length === 0, errors: e };
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
    need(fm, "addends", isString, "addends must be the wikilink of the target", e);
    need(fm, "kind", isString, "kind must be one of the addendum kinds", e);
    need(fm, "date", isIsoDate, "date must be ISO YYYY-MM-DD", e);
    return { passed: e.filter((x) => x.severity === "error").length === 0, errors: e };
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
}

export const TaskSchema: EntitySchema<TaskFrontmatter> = {
  type: "task",
  description: "An actionable item, optionally linked to a contact/org.",
  defaultFrontmatter: () => ({ type: "task", title: "", status: "todo" }),
  validate(fm) {
    const e: ValidationError[] = [];
    if (fm.type !== "task") e.push(err("type", `expected "task"`));
    need(fm, "title", isString, "title must be a string", e);
    if (!["todo", "in_progress", "blocked", "done", "cancelled"].includes(String(fm.status))) {
      e.push(err("status", "status must be a known value"));
    }
    if ("due" in fm && !isIsoDate(fm.due)) e.push(err("due", "due must be ISO date", "warn"));
    return { passed: e.filter((x) => x.severity === "error").length === 0, errors: e };
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
    if (!["pending", "done", "skipped"].includes(String(fm.status))) e.push(err("status", "unknown status"));
    return { passed: e.filter((x) => x.severity === "error").length === 0, errors: e };
  },
  parse(fm) {
    const r = this.validate(fm);
    if (!r.passed) return null;
    return fm as FollowupFrontmatter;
  },
};

// ---------- idea ----------

export interface IdeaFrontmatter extends Record<string, unknown> {
  type: "idea";
  title: string;
  related_contacts?: string[];
  status: "open" | "considering" | "shipped" | "shelved";
  tags?: string[];
}

export const IdeaSchema: EntitySchema<IdeaFrontmatter> = {
  type: "idea",
  description: "A spark or concept tied to contacts/orgs.",
  defaultFrontmatter: () => ({ type: "idea", title: "", status: "open" }),
  validate(fm) {
    const e: ValidationError[] = [];
    if (fm.type !== "idea") e.push(err("type", `expected "idea"`));
    need(fm, "title", isString, "title must be a string", e);
    if (!["open", "considering", "shipped", "shelved"].includes(String(fm.status))) e.push(err("status", "unknown status"));
    return { passed: e.filter((x) => x.severity === "error").length === 0, errors: e };
  },
  parse(fm) {
    const r = this.validate(fm);
    if (!r.passed) return null;
    return fm as IdeaFrontmatter;
  },
};

// ---------- ledger-entry ----------

export interface LedgerEntryFrontmatter extends Record<string, unknown> {
  type: "ledger-entry";
  contact: string;
  date: string;
  category: string;
  amount: number;
  currency: string;
  direction: "in" | "out";
  notes?: string;
}

export const LedgerEntrySchema: EntitySchema<LedgerEntryFrontmatter> = {
  type: "ledger-entry",
  description: "A financial/value-flow record between operator and contact.",
  defaultFrontmatter: () => ({
    type: "ledger-entry",
    contact: "",
    date: new Date().toISOString().slice(0, 10),
    category: "favor",
    amount: 0,
    currency: "USD",
    direction: "out",
  }),
  validate(fm) {
    const e: ValidationError[] = [];
    if (fm.type !== "ledger-entry") e.push(err("type", `expected "ledger-entry"`));
    need(fm, "contact", isString, "contact must be a wikilink", e);
    need(fm, "date", isIsoDate, "date must be ISO date", e);
    need(fm, "amount", isNumber, "amount must be a number", e);
    if (!["in", "out"].includes(String(fm.direction))) e.push(err("direction", "direction must be in/out"));
    return { passed: e.filter((x) => x.severity === "error").length === 0, errors: e };
  },
  parse(fm) {
    const r = this.validate(fm);
    if (!r.passed) return null;
    return fm as LedgerEntryFrontmatter;
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
    need(fm, "period", isString, "period must be a string like YYYY-MM or YYYY-Q1", e);
    return { passed: e.filter((x) => x.severity === "error").length === 0, errors: e };
  },
  parse(fm) {
    const r = this.validate(fm);
    if (!r.passed) return null;
    return fm as RollupFrontmatter;
  },
};

// ---------- registry ----------

export const ENTITY_SCHEMAS = {
  "warm-contact": PersonSchema,
  "org":          OrgSchema,
  "touch":        TouchSchema,
  "addendum":     AddendumSchema,
  "task":         TaskSchema,
  "followup":     FollowupSchema,
  "idea":         IdeaSchema,
  "ledger-entry": LedgerEntrySchema,
  "rollup":       RollupSchema,
} as const;

/** Dispatch validation by the frontmatter's `type` field. Returns null
 *  if the type is unknown — that's a "not a sauce entity" signal. */
export function validateEntity(fm: Record<string, unknown>): ValidationResult | null {
  const t = fm.type;
  if (typeof t !== "string") return null;
  const schema = (ENTITY_SCHEMAS as Record<string, EntitySchema<Record<string, unknown>>>)[t];
  if (!schema) return null;
  return schema.validate(fm);
}
