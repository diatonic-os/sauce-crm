import { KnowledgeNote } from "./KnowledgeNote";

export class Idea extends KnowledgeNote {
  static override readonly TYPE = "idea";

  get stage(): string {
    return this.frontmatter.stage ?? "seed";
  }
  get impact(): string {
    return this.frontmatter.impact ?? "medium";
  }
  get effort(): string {
    return this.frontmatter.effort ?? "medium";
  }
  get next_action(): string | null {
    return this.frontmatter.next_action ?? null;
  }
}
