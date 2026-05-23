import { Entity } from "./Entity";

export class KnowledgeNote extends Entity {
  static readonly TYPE: string = "knowledge-note";

  get title(): string {
    return this.frontmatter.title ?? this.file.basename;
  }
  get date(): string {
    return this.frontmatter.date ?? "";
  }
  get contact(): string | null {
    return this.frontmatter.contact ?? null;
  }
  get org(): string | null {
    return this.frontmatter.org ?? null;
  }
  get topic(): string | null {
    return this.frontmatter.topic ?? null;
  }
  get confidence(): string {
    return this.frontmatter.confidence ?? "medium";
  }
}
