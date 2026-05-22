import { App, normalizePath, TFile } from "obsidian";
import { EntityService, VaultPaths, DEFAULT_PATHS } from "./EntityService";

export class VaultBootstrapper {
  constructor(public app: App, public paths: VaultPaths = DEFAULT_PATHS) {}

  async ensure(): Promise<{ created: string[]; existing: string[] }> {
    const created: string[] = [];
    const existing: string[] = [];
    const svc = new EntityService(this.app, this.paths);

    for (const p of [
      this.paths.people, this.paths.orgs, this.paths.touches,
      this.paths.addenda, this.paths.templates, this.paths.playbooks,
      this.paths.user,
    ]) {
      const folder = this.app.vault.getAbstractFileByPath(normalizePath(p));
      if (folder) existing.push(p); else { await svc.ensureFolder(p); created.push(p); }
    }

    await this.ensureFile("CLAUDE.md", CLAUDE_SEED);
    await this.ensureFile("_README.md", README_SEED);
    await this.ensureFile("_MOC.md", MOC_SEED);
    await this.ensureFile("_DASHBOARD.md", DASHBOARD_SEED);
    await this.ensureFile("_TASKS.md", TASKS_SEED);
    await this.ensureFile("_ADDENDA.md", ADDENDA_SEED);
    await this.ensureFile("_PLUGIN-CONFIG.md", PLUGIN_CONFIG_SEED);

    return { created, existing };
  }

  private async ensureFile(path: string, body: string): Promise<TFile | null> {
    const np = normalizePath(path);
    const ex = this.app.vault.getAbstractFileByPath(np);
    if (ex && ex instanceof TFile) return ex;
    return await this.app.vault.create(np, body);
  }
}

const CLAUDE_SEED = `---
type: vault-contract
contract: extended
subtype_of: SubVault
generated_by: sauce-graph/VaultBootstrapper
spec_version: spec-v0.1
mutable: [enums, edge_rules, hotkeys, addendum_policy]
tags: [vault-contract, machine-readable]
---

# Vault Contract

Generated file. Do not hand-edit. Use the Sauce Graph Settings tab.
`;

const README_SEED = `---
type: orientation
contract: nosubtype
generated_by: sauce-graph/VaultBootstrapper
tags: [readme, orientation]
---

# Sauce Graph Vault

Use the command palette (default hotkeys below) to author everything.

- \`Cmd+Shift+P\` — New Person
- \`Cmd+Shift+O\` — New Org
- \`Cmd+Shift+T\` — Log Touch
- \`Cmd+Shift+A\` — New Addendum
- \`Cmd+Shift+I\` — New Intro
- \`Cmd+E\`       — Edit Current
`;

const MOC_SEED = `---
type: dashboard
view: operational
tags: [moc, dashboard, live]
---

# _MOC

\`\`\`sauce-dql
TABLE last_touch, cadence, closeness FROM "people" WHERE type == "warm-contact" SORT last_touch ASC LIMIT 25
\`\`\`
`;

const DASHBOARD_SEED = `---
type: dashboard
view: analytics
tags: [dashboard, analytics, live]
---

# _DASHBOARD

Open the Sauce Dashboard view for the rich UI.
`;

const TASKS_SEED = `---
type: dashboard
view: tasks
tags: [tasks, ledger, live]
---

# _TASKS

\`\`\`sauce-dql
TASK FROM "touches"
\`\`\`
`;

const ADDENDA_SEED = `---
type: dashboard
view: addenda
tags: [addenda, index, live]
---

# _ADDENDA

\`\`\`sauce-dql
TABLE addends, kind, date, author FROM "_addenda" SORT date DESC
\`\`\`
`;

const PLUGIN_CONFIG_SEED = `---
type: plugin-config
contract: simple
subtype_of: Entity
mutable: [enums, edge_rules, hotkeys, addendum_policy, compat_config, semiring_choices, search_config]
enums:
  primary_type_person: [co-founder, family, advisor, mentor, connector, peer-founder, community, past-colleague, prospect]
  roles_person: [co-founder, family, advisor, mentor, connector, peer-founder, community, past-colleague, prospect]
  cadence: [monthly, quarterly, bi-annual, ad-hoc]
  channel: [in-person, call, text, dinner, email, event]
  outcome_tag: [update-given, advice-received, intro-offered, intro-made, asked-for-intro]
  status_org: [active, customer, vendor, competitor, defunct, prospect]
  kind_addendum: [correction, enrichment, context, deprecation, merge-note]
compat_config:
  rho_adm: 0.5
  fields: [roles, tags, industry, location]
tags: [plugin-config, contract]
---

# _PLUGIN-CONFIG

Edit via the Settings tab.
`;
