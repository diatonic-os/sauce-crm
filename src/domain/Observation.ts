import { KnowledgeNote } from "./KnowledgeNote";

export class Observation extends KnowledgeNote {
  static override readonly TYPE = "observation";

  get signal(): string {
    return this.frontmatter.signal ?? "relationship";
  }
  get evidence(): string | null {
    return this.frontmatter.evidence ?? null;
  }
}
