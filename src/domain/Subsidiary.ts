import { Org } from "./Org";

/**
 * LSP subclass: Org with non-empty `parent`. Substitutes anywhere Org is referenced.
 * Postcondition strengthening: subsidiary status is constrained relative to parent.
 */
export class Subsidiary extends Org {
  static readonly SUBTYPE = "subsidiary";

  override get parent(): string {
    const p = this.frontmatter.parent;
    if (!p) throw new Error("Subsidiary invariant violation: parent is null");
    return p;
  }

  // LSP: subsidiary cannot be defunct while parent is active without an addendum.
  isStatusValidGivenParent(parentStatus: string): boolean {
    if (this.status === "defunct" && ["active", "customer", "vendor"].includes(parentStatus)) {
      return false;
    }
    return true;
  }
}
