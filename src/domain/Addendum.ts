import { Entity } from "./Entity";

export class Addendum extends Entity {
  static readonly TYPE = "addendum";

  get addends(): string | null { return this.frontmatter.addends ?? null; }
  get date(): string { return this.frontmatter.date ?? ""; }
  get author(): string | null { return this.frontmatter.author ?? null; }
  get kind(): string { return this.frontmatter.kind ?? "context"; }

  // LSP: postcondition strengthens — mutable is empty for all addenda.
  override get mutable(): string[] { return []; }
}
