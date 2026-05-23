import { Entity } from "./Entity";

export class LedgerEntry extends Entity {
  static readonly TYPE = "ledger-entry";

  get title(): string {
    return this.frontmatter.title ?? this.file.basename;
  }
  get date(): string {
    return this.frontmatter.date ?? "";
  }
  get category(): string {
    return this.frontmatter.category ?? "relationship";
  }
  get direction(): "in" | "out" {
    return this.frontmatter.direction === "in" ? "in" : "out";
  }
  get amount(): number {
    return Number(this.frontmatter.amount ?? 0);
  }
  get currency(): string {
    return this.frontmatter.currency ?? "USD";
  }
}
