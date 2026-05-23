import { Entity } from "./Entity";

export class EventEntity extends Entity {
  static readonly TYPE = "event";

  get title(): string {
    return this.frontmatter.title ?? this.file.basename;
  }
  get date(): string {
    return this.frontmatter.date ?? "";
  }
  get start(): string | null {
    return this.frontmatter.start ?? null;
  }
  get end(): string | null {
    return this.frontmatter.end ?? null;
  }
  get attendees(): string[] {
    return this.frontmatter.attendees ?? [];
  }
}
