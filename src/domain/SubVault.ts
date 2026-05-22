import { Entity } from "./Entity";

/**
 * SubVault registration entry (lives at <ParentVault>/vaults/<id>.md).
 * Federated-op interface declared in frontmatter; FederationValidator checks
 * LSP substitutability against ParentVault.
 */
export class SubVault extends Entity {
  static readonly TYPE = "sub-vault";

  get vault_id(): string { return this.frontmatter.vault_id ?? ""; }
  get path(): string { return this.frontmatter.path ?? ""; }
  get role(): string { return this.frontmatter.role ?? "secondary"; }
  get enabled(): boolean { return Boolean(this.frontmatter.enabled ?? true); }
  get spec_version(): string { return this.frontmatter.spec_version ?? "unknown"; }
  get contract_ref(): string | null { return this.frontmatter.contract_ref ?? null; }
}
