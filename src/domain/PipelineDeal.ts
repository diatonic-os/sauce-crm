import { Entity } from "./Entity";

export class PipelineDeal extends Entity {
  static readonly TYPE = "pipeline-deal";

  get title(): string { return this.frontmatter.title ?? this.file.basename; }
  get stage(): string { return this.frontmatter.stage ?? "prospect"; }
  get value(): number | null {
    const v = Number(this.frontmatter.value);
    return Number.isFinite(v) ? v : null;
  }
  get probability(): number { return Number(this.frontmatter.probability ?? 0.25); }
  get next_action(): string | null { return this.frontmatter.next_action ?? null; }
}
