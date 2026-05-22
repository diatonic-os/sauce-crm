import { App, normalizePath, TFile } from "obsidian";
import { todayIso } from "../util/DateUtil";

export class ParentVaultBootstrapper {
  constructor(public app: App) {}

  async ensure(): Promise<void> {
    const folder = this.app.vault.getAbstractFileByPath("vaults");
    if (!folder) await this.app.vault.createFolder("vaults");
    const addenda = this.app.vault.getAbstractFileByPath("_addenda");
    if (!addenda) await this.app.vault.createFolder("_addenda");
    const pv = this.app.vault.getAbstractFileByPath("PARENT-VAULT.md");
    if (!(pv instanceof TFile)) {
      await this.app.vault.create("PARENT-VAULT.md", PARENT_VAULT_SEED.replace("{{date}}", todayIso()));
    }
  }
}

const PARENT_VAULT_SEED = `---
type: parent-vault
contract: extended
subtype_of: Entity
vault_id: sauce-graph-parent
generated_by: sauce-graph/ParentVaultBootstrapper
generated_at: {{date}}
spec_ref: "./SPEC.md"
registry_dir: "./vaults/"
mutable: [registry, federation_policy, default_subvault]
constrains:
  - registry_dir_exists
  - every_subvault_resolves
  - subvault_ids_unique
  - no_cyclic_parent
ensures:
  - liskov_substitutability
  - postcondition_strengthening
  - frame_shrinkage
signals:
  - SubVaultUnreachable
  - ContractDrift
  - FederationDesync
federation_policy:
  cross_vault_edges: allowed
  cross_vault_path_queries: allowed
  cross_vault_compatibility: allowed
  enum_resolution: parent-wins
  addendum_rollup: latest
  validation_gate: strict
registry: []
tags: [parent-vault, registry, contract]
---

# Parent Vault

Created by Sauce Graph. Use \`Sauce: Register SubVault\` to add child vaults.
`;
