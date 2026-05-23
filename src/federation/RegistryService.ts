import { App, TFile, normalizePath } from "obsidian";
import { ParentVault, RegistryEntry } from "../domain/ParentVault";
import { SubVault } from "../domain/SubVault";
import { entityFromFrontmatter } from "../domain/Factory";
import { todayIso } from "../util/DateUtil";

export class RegistryService {
  constructor(public app: App) {}

  loadParentVault(): ParentVault | null {
    const f = this.app.vault.getAbstractFileByPath("PARENT-VAULT.md");
    if (!(f instanceof TFile)) return null;
    const fm = this.app.metadataCache.getFileCache(f)?.frontmatter;
    if (!fm) return null;
    const e = entityFromFrontmatter(f, fm);
    return e instanceof ParentVault ? e : null;
  }

  listSubVaults(): SubVault[] {
    const out: SubVault[] = [];
    const folder = this.app.vault.getAbstractFileByPath("vaults");
    if (!folder) return out;
    for (const f of this.app.vault.getMarkdownFiles()) {
      if (!f.path.startsWith("vaults/")) continue;
      const fm = this.app.metadataCache.getFileCache(f)?.frontmatter;
      if (!fm) continue;
      const e = entityFromFrontmatter(f, fm);
      if (e instanceof SubVault) out.push(e);
    }
    return out;
  }

  async registerSubVault(input: {
    vault_id: string;
    path: string;
    role?: string;
    spec_version?: string;
  }): Promise<TFile> {
    const targetPath = normalizePath(`vaults/${input.vault_id}.md`);
    const folder = this.app.vault.getAbstractFileByPath("vaults");
    if (!folder) await this.app.vault.createFolder("vaults");
    const ex = this.app.vault.getAbstractFileByPath(targetPath);
    if (ex instanceof TFile) {
      await this.app.fileManager.processFrontMatter(ex, (fm) => {
        fm.enabled = true;
        fm.last_registered = todayIso();
      });
      return ex;
    }
    const body = `---
type: sub-vault
contract: simple
subtype_of: SubVault
vault_id: ${input.vault_id}
path: "${input.path}"
role: ${input.role ?? "secondary"}
parent_vault: "[[../PARENT-VAULT]]"
contract_ref: "[[${input.path}/CLAUDE]]"
spec_version: ${input.spec_version ?? "spec-v0.1"}
enabled: true
registered_at: ${todayIso()}
mutable: [enabled, role, last_validated, last_validated_result]
tags: [sub-vault, registry-entry]
---

# SubVault Registration — ${input.vault_id}

<!-- BEGIN sauce-graph:validation-log -->
<!-- END sauce-graph:validation-log -->
`;
    return await this.app.vault.create(targetPath, body);
  }

  async unregisterSubVault(vault_id: string): Promise<void> {
    const f = this.app.vault.getAbstractFileByPath(
      normalizePath(`vaults/${vault_id}.md`),
    );
    if (!(f instanceof TFile)) return;
    await this.app.fileManager.processFrontMatter(f, (fm) => {
      fm.enabled = false;
      fm.unregistered_at = todayIso();
    });
  }

  registryEntries(): RegistryEntry[] {
    const pv = this.loadParentVault();
    if (pv) return pv.registry;
    return this.listSubVaults().map((sv) => ({
      vault_id: sv.vault_id,
      path: sv.path,
      role: sv.role as any,
      parent_of: null,
      contract: sv.contract_ref ?? "",
      spec_version: sv.spec_version,
      enabled: sv.enabled,
    }));
  }
}
