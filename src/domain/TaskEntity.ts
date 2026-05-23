import { Entity } from "./Entity";

export class TaskEntity extends Entity {
  static readonly TYPE = "task";

  get title(): string { return this.frontmatter.title ?? this.file.basename; }
  get status(): string { return this.frontmatter.status ?? "todo"; }
  get priority(): string { return this.frontmatter.priority ?? "medium"; }
  get due(): string | null { return this.frontmatter.due ?? null; }
  get contact(): string | null { return this.frontmatter.contact ?? null; }
  get approval_required(): boolean { return Boolean(this.frontmatter.approval_required ?? false); }
}
