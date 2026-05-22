import { Entity } from "./Entity";

export class Person extends Entity {
  static readonly TYPE = "warm-contact";

  get primary_type(): string { return this.frontmatter.primary_type ?? ""; }
  get roles(): string[] { return this.frontmatter.roles ?? []; }
  get closeness(): number { return Number(this.frontmatter.closeness ?? 3); }
  get cadence(): string { return this.frontmatter.cadence ?? "quarterly"; }
  get last_touch(): string | null { return this.frontmatter.last_touch ?? null; }
  get company(): string | null { return this.frontmatter.company ?? null; }
  get knows(): string[] { return this.frontmatter.knows ?? []; }
  get worked_with(): string[] { return this.frontmatter.worked_with ?? []; }
  get intro_candidates(): string[] { return this.frontmatter.intro_candidates ?? []; }
  get family_of(): string | null { return this.frontmatter.family_of ?? null; }
  get intro_via(): string | null { return this.frontmatter.intro_via ?? null; }
  get intro_opt_in(): boolean { return Boolean(this.frontmatter.intro_opt_in ?? false); }

  isOverdue(today: Date = new Date()): boolean {
    if (!this.last_touch) return true;
    const last = new Date(this.last_touch);
    const days = Math.floor((today.getTime() - last.getTime()) / (1000 * 60 * 60 * 24));
    const cap: Record<string, number> = {
      monthly: 30, quarterly: 90, "bi-annual": 182, "ad-hoc": 365,
    };
    return days > (cap[this.cadence] ?? 90);
  }
}
