import { Entity } from "./Entity";

export interface RegistryEntry {
  vault_id: string;
  path: string;
  role: "primary" | "secondary" | "archive";
  parent_of: string | null;
  contract: string;
  spec_version: string;
  enabled: boolean;
}

export interface FederationPolicy {
  cross_vault_edges: "allowed" | "denied";
  cross_vault_path_queries: "allowed" | "denied";
  cross_vault_compatibility: "allowed" | "denied";
  enum_resolution: "parent-wins" | "union" | "subvault-wins";
  addendum_rollup: "latest" | "all" | "off";
  validation_gate: "strict" | "warn" | "off";
}

export class ParentVault extends Entity {
  static readonly TYPE = "parent-vault";

  get vault_id(): string { return this.frontmatter.vault_id ?? ""; }
  get registry_dir(): string { return this.frontmatter.registry_dir ?? "./vaults/"; }
  get registry(): RegistryEntry[] { return this.frontmatter.registry ?? []; }
  get federation_policy(): FederationPolicy {
    return this.frontmatter.federation_policy ?? {
      cross_vault_edges: "allowed",
      cross_vault_path_queries: "allowed",
      cross_vault_compatibility: "allowed",
      enum_resolution: "parent-wins",
      addendum_rollup: "latest",
      validation_gate: "strict",
    };
  }
  get default_subvault(): string | null { return this.frontmatter.default_subvault ?? null; }
}
