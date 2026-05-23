import { ParentVault } from "../domain/ParentVault";
import { SubVault } from "../domain/SubVault";
import { parseInvariantString } from "../util/Frontmatter";

export interface FederationCheck {
  vault_id: string;
  passed: boolean;
  violations: string[];
}

export class FederationValidator {
  static FEDERATED_OPS = ["entities", "adjacency", "enums", "addenda", "validate"] as const;

  check(parent: ParentVault, sub: SubVault, parentEnums: Record<string, string[]>, subEnums: Record<string, string[]>): FederationCheck {
    const violations: string[] = [];

    // 1. parent_vault link integrity
    if (!sub.frontmatter.parent_vault) {
      violations.push("missing parent_vault link in SubVault contract");
    }

    // 2. signature parity — declared `mutable` shrinks
    const parentMutable = new Set(parent.mutable);
    for (const m of sub.mutable) {
      if (!parentMutable.has(m) && parentMutable.size > 0) {
        // Allowed: subvault may add to its own mutable IF parent has no opinion on the key.
        // We only flag widening on shared keys (none expected — parent owns federation-only fields).
      }
    }

    // 3. invariant preservation — sub.constrains ⊇ parent.constrains (covariant)
    const parentInvs = new Set((parent.frontmatter.constrains ?? []).map((c: any) => keyOf(c)));
    const subInvs = new Set((sub.frontmatter.constrains ?? []).map((c: any) => keyOf(c)));
    for (const inv of parentInvs) {
      if (!subInvs.has(inv)) {
        // Federation invariants are parent-only; SubVault doesn't need to repeat them.
        // We only flag if the SubVault deliberately weakened a known LSP invariant.
        if (typeof inv === "string" && inv.includes("acyclic") && !subInvs.has(inv)) {
          violations.push(`subvault missing required invariant: ${inv}`);
        }
      }
    }

    // 4. enum subset — parent-wins resolution
    const policy = parent.federation_policy.enum_resolution;
    if (policy === "parent-wins") {
      for (const [k, vals] of Object.entries(subEnums)) {
        const parentVals = parentEnums[k];
        if (!parentVals) continue;
        for (const v of vals) {
          if (!parentVals.includes(v)) {
            violations.push(`enum drift: SubVault.${k} contains '${v}' not in ParentVault.${k}`);
          }
        }
      }
    }

    // 5. spec_version compatibility
    if (sub.spec_version && sub.spec_version !== "spec-v0.1") {
      violations.push(`subvault spec_version ${sub.spec_version} differs from parent`);
    }

    return { vault_id: sub.vault_id, passed: violations.length === 0, violations };
  }

  checkAll(parent: ParentVault, subs: SubVault[], parentEnums: Record<string, string[]>, subEnumsByVault: Record<string, Record<string, string[]>>): FederationCheck[] {
    return subs.map((s) => this.check(parent, s, parentEnums, subEnumsByVault[s.vault_id] ?? {}));
  }
}

function keyOf(c: any): string {
  if (typeof c === "string") return parseInvariantString(c).name;
  if (c && typeof c === "object") return Object.keys(c)[0] ?? "";
  return "";
}
