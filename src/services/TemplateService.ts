import { todayIso } from "../util/DateUtil";

/**
 * The plugin owns its entity templates. There is no Templater `<% %>` surface
 * exposed to the user — templates are pure functions of the modal output.
 */
export const TemplateService = {
  personFrontmatter(input: Partial<Record<string, any>>): Record<string, any> {
    return {
      type: "warm-contact",
      contract: input.contract ?? "simple",
      subtype_of: "Entity",
      primary_type: input.primary_type,
      roles: input.roles ?? (input.primary_type ? [input.primary_type] : []),
      closeness: input.closeness ?? 3,
      cadence: input.cadence ?? "quarterly",
      last_touch: input.last_touch ?? null,
      location: input.location ?? null,
      company: input.company ?? null,
      title: input.title ?? null,
      email: input.email ?? null,
      phone: input.phone ?? null,
      linkedin: input.linkedin ?? null,
      intro_via: input.intro_via ?? null,
      intro_opt_in: input.intro_opt_in ?? false,
      knows: input.knows ?? [],
      worked_with: input.worked_with ?? [],
      intro_candidates: input.intro_candidates ?? [],
      family_of: input.family_of ?? null,
      mutable: ["last_touch","closeness","cadence","roles","knows","worked_with","intro_candidates","company","title","email","phone","linkedin","location"],
      constrains: [
        { closeness_range: "closeness >= 1 && closeness <= 5" },
        { cadence_in_enum: "cadence in enum.cadence" },
        { primary_in_roles: "primary_type in roles" },
      ],
      tags: input.tags ?? ["warm-network"],
    };
  },

  orgFrontmatter(input: Partial<Record<string, any>>): Record<string, any> {
    return {
      type: input.parent ? "subsidiary" : "org",
      contract: input.contract ?? "simple",
      subtype_of: input.parent ? "Org" : "Entity",
      primary_type: "org",
      industry: input.industry ?? null,
      location: input.location ?? null,
      website: input.website ?? null,
      status: input.status ?? "active",
      parent: input.parent ?? null,
      mutable: ["industry","location","website","status","parent"],
      constrains: [
        { status_in_enum: "status in enum.status_org" },
      ],
      tags: input.tags ?? ["org"],
    };
  },

  touchFrontmatter(input: Partial<Record<string, any>>): Record<string, any> {
    return {
      type: "touch",
      contract: "core",
      subtype_of: "Entity",
      contact: input.contact,
      date: input.date ?? todayIso(),
      channel: input.channel ?? "in-person",
      playbook_used: input.playbook_used ?? "",
      outcome_tags: input.outcome_tags ?? [],
      referral_to: input.referral_to ?? null,
      attendees: input.attendees ?? (input.contact ? [input.contact] : []),
      source: input.source ?? null,
      author: input.author ?? null,
      mutable: ["outcome_tags","referral_to","attendees","source"],
      constrains: [
        { contact_in_attendees: "contact in attendees" },
        { channel_in_enum: "channel in enum.channel" },
      ],
    };
  },

  addendumFrontmatter(input: Partial<Record<string, any>>): Record<string, any> {
    return {
      type: "addendum",
      contract: "core",
      subtype_of: "Entity",
      addends: input.addends,
      date: input.date ?? todayIso(),
      author: input.author ?? null,
      kind: input.kind ?? "context",
      mutable: [],
      constrains: [{ immutable_after_save: "true" }],
      tags: input.tags ?? ["addendum"],
    };
  },

  knowledgeNoteFrontmatter(input: Partial<Record<string, any>>): Record<string, any> {
    return {
      type: "knowledge-note",
      contract: input.contract ?? "simple",
      subtype_of: "Entity",
      title: input.title,
      date: input.date ?? todayIso(),
      contact: input.contact ?? null,
      org: input.org ?? null,
      topic: input.topic ?? null,
      source: input.source ?? null,
      visibility: input.visibility ?? "private",
      confidence: input.confidence ?? "medium",
      mutable: ["title", "contact", "org", "topic", "source", "visibility", "confidence", "tags"],
      constrains: [
        { title_required: "title != null" },
        { visibility_enum: "visibility in [private, team, domain]" },
      ],
      tags: input.tags ?? ["knowledge-note"],
    };
  },

  ideaFrontmatter(input: Partial<Record<string, any>>): Record<string, any> {
    return {
      type: "idea",
      contract: input.contract ?? "simple",
      subtype_of: "knowledge-note",
      title: input.title,
      date: input.date ?? todayIso(),
      contact: input.contact ?? null,
      org: input.org ?? null,
      stage: input.stage ?? "seed",
      impact: input.impact ?? "medium",
      effort: input.effort ?? "medium",
      next_action: input.next_action ?? null,
      owner: input.owner ?? null,
      mutable: ["title", "stage", "impact", "effort", "next_action", "owner", "contact", "org", "tags"],
      constrains: [
        { stage_enum: "stage in [seed, shaping, planned, active, shipped, archived]" },
      ],
      tags: input.tags ?? ["idea"],
    };
  },

  observationFrontmatter(input: Partial<Record<string, any>>): Record<string, any> {
    return {
      type: "observation",
      contract: input.contract ?? "simple",
      subtype_of: "knowledge-note",
      title: input.title,
      date: input.date ?? todayIso(),
      contact: input.contact ?? null,
      org: input.org ?? null,
      signal: input.signal ?? "relationship",
      confidence: input.confidence ?? "medium",
      evidence: input.evidence ?? null,
      mutable: ["title", "signal", "confidence", "evidence", "contact", "org", "tags"],
      constrains: [
        { signal_enum: "signal in [relationship, opportunity, risk, timing, access, pattern]" },
      ],
      tags: input.tags ?? ["observation"],
    };
  },

  taskFrontmatter(input: Partial<Record<string, any>>): Record<string, any> {
    return {
      type: "task",
      contract: input.contract ?? "simple",
      subtype_of: "Entity",
      title: input.title,
      status: input.status ?? "todo",
      priority: input.priority ?? "medium",
      due: input.due ?? null,
      contact: input.contact ?? null,
      org: input.org ?? null,
      owner: input.owner ?? null,
      approval_required: input.approval_required ?? false,
      source: input.source ?? "manual",
      mutable: ["title", "status", "priority", "due", "contact", "org", "owner", "approval_required", "tags"],
      constrains: [
        { status_enum: "status in [todo, in_progress, blocked, done, cancelled]" },
        { priority_enum: "priority in [low, medium, high, urgent]" },
      ],
      tags: input.tags ?? ["task", "followup"],
    };
  },

  eventFrontmatter(input: Partial<Record<string, any>>): Record<string, any> {
    return {
      type: "event",
      contract: input.contract ?? "simple",
      subtype_of: "Entity",
      title: input.title,
      date: input.date ?? todayIso(),
      start: input.start ?? null,
      end: input.end ?? null,
      channel: input.channel ?? "call",
      attendees: input.attendees ?? [],
      contact: input.contact ?? null,
      org: input.org ?? null,
      source_calendar: input.source_calendar ?? null,
      mutable: ["title", "date", "start", "end", "channel", "attendees", "contact", "org", "source_calendar", "tags"],
      constrains: [
        { date_required: "date != null" },
      ],
      tags: input.tags ?? ["event"],
    };
  },

  ledgerEntryFrontmatter(input: Partial<Record<string, any>>): Record<string, any> {
    return {
      type: "ledger-entry",
      contract: input.contract ?? "simple",
      subtype_of: "Entity",
      title: input.title,
      date: input.date ?? todayIso(),
      contact: input.contact ?? null,
      org: input.org ?? null,
      category: input.category ?? "relationship",
      direction: input.direction ?? "out",
      amount: input.amount ?? 0,
      currency: input.currency ?? "USD",
      approval_required: input.approval_required ?? true,
      notes: input.notes ?? null,
      mutable: ["title", "date", "contact", "org", "category", "direction", "amount", "currency", "approval_required", "notes", "tags"],
      constrains: [
        { direction_enum: "direction in [in, out]" },
        { amount_non_negative: "amount >= 0" },
      ],
      tags: input.tags ?? ["ledger"],
    };
  },

  pipelineDealFrontmatter(input: Partial<Record<string, any>>): Record<string, any> {
    return {
      type: "pipeline-deal",
      contract: input.contract ?? "simple",
      subtype_of: "Entity",
      title: input.title,
      stage: input.stage ?? "prospect",
      date: input.date ?? todayIso(),
      contact: input.contact ?? null,
      org: input.org ?? null,
      value: input.value ?? null,
      currency: input.currency ?? "USD",
      probability: input.probability ?? 0.25,
      next_action: input.next_action ?? null,
      owner: input.owner ?? null,
      mutable: ["title", "stage", "contact", "org", "value", "currency", "probability", "next_action", "owner", "tags"],
      constrains: [
        { stage_enum: "stage in [prospect, first-touch, discovery, proposal, closed-won, closed-lost]" },
      ],
      tags: input.tags ?? ["pipeline"],
    };
  },
};
