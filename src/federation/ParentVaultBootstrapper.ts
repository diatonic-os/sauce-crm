import { App, normalizePath, TFile } from "obsidian";
import { todayIso } from "../util/DateUtil";
import { DEFAULT_PATHS } from "../services/EntityService";

// Vault paths handed to Obsidian Vault APIs are normalized once, here, so the
// separators + leading-slash safety that normalizePath provides apply uniformly
// — matching the codebase-wide convention (v2-init, ImportMappingModal,
// EdgeSyncService, ObsidianAdapters, main.ts). Defined as constants so the
// getAbstractFileByPath check and the create/createFolder call can never drift.
const VAULTS_DIR = normalizePath("vaults");
const ADDENDA_DIR = normalizePath(DEFAULT_PATHS.addenda);
const PARENT_VAULT_FILE = normalizePath("PARENT-VAULT.md");

export class ParentVaultBootstrapper {
  constructor(public app: App) {}

  async ensure(): Promise<void> {
    const folder = this.app.vault.getAbstractFileByPath(VAULTS_DIR);
    if (!folder) await this.app.vault.createFolder(VAULTS_DIR);
    const addenda = this.app.vault.getAbstractFileByPath(ADDENDA_DIR);
    if (!addenda) await this.app.vault.createFolder(ADDENDA_DIR);
    const pv = this.app.vault.getAbstractFileByPath(PARENT_VAULT_FILE);
    if (!(pv instanceof TFile)) {
      await this.app.vault.create(
        PARENT_VAULT_FILE,
        PARENT_VAULT_SEED.replace("{{date}}", todayIso()),
      );
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
enterprise_policy:
  policy_note: "[[_POLICY]]"
  top_level_domain: sauce.local
  founder_group: founder-group
  default_department: general
  invite_requires_role: true
  upstream_rollups:
    personal: private-by-default
    department: kpi-summary
    domain: approved-summary
registry: []
tags: [parent-vault, registry, contract]
---

# Parent Vault

Created by Sauce Graph. Use \`Sauce: Register SubVault\` to add child vaults.
`;
