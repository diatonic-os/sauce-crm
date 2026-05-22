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
};
