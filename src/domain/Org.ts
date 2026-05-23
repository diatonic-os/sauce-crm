import { Entity } from "./Entity";

export class Org extends Entity {
  static readonly TYPE = "org";

  get industry(): string | null {
    return this.frontmatter.industry ?? null;
  }
  get website(): string | null {
    return this.frontmatter.website ?? null;
  }
  get status(): string {
    return this.frontmatter.status ?? "active";
  }
  get parent(): string | null {
    return this.frontmatter.parent ?? null;
  }
  get location(): string | null {
    return this.frontmatter.location ?? null;
  }

  isSubsidiary(): boolean {
    return !!this.parent;
  }
}
