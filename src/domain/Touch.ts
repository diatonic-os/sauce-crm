import { Entity } from "./Entity";

export class Touch extends Entity {
  static readonly TYPE = "touch";

  get contact(): string | null { return this.frontmatter.contact ?? null; }
  get date(): string { return this.frontmatter.date ?? ""; }
  get channel(): string { return this.frontmatter.channel ?? "in-person"; }
  get playbook_used(): string { return this.frontmatter.playbook_used ?? ""; }
  get outcome_tags(): string[] { return this.frontmatter.outcome_tags ?? []; }
  get attendees(): string[] { return this.frontmatter.attendees ?? []; }
  get referral_to(): string | null { return this.frontmatter.referral_to ?? null; }
  get source(): string | null { return this.frontmatter.source ?? null; }
  get author(): string | null { return this.frontmatter.author ?? null; }
}
