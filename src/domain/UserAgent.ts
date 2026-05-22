import { Entity } from "./Entity";

export class UserAgent extends Entity {
  static readonly TYPE = "user-agent";

  get agent_id(): string { return this.frontmatter.agent_id ?? ""; }
  get tier(): number { return Number(this.frontmatter.tier ?? 1); }
  get operator(): string | null { return this.frontmatter.operator ?? null; }
  get roles(): string[] { return this.frontmatter.roles ?? []; }
  get authority(): Record<string, any> { return this.frontmatter.authority ?? {}; }
}
