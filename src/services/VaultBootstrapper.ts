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
      this.paths.addenda, this.paths.notes, this.paths.ideas,
      this.paths.observations, this.paths.tasks, this.paths.events,
      this.paths.ledger, this.paths.pipeline, this.paths.templates, this.paths.playbooks,
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
    await this.ensureFile("_IDEAS.md", IDEAS_SEED);
    await this.ensureFile("_EVENTS.md", EVENTS_SEED);
    await this.ensureFile("_LEDGER.md", LEDGER_SEED);
    await this.ensureFile("_POLICY.md", POLICY_SEED);
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

The plugin also owns modal-first capture for notes, ideas, observations,
tasks, events, ledger entries, and pipeline deals. Use the Sauce CRM ribbon
or command palette instead of hand-authoring frontmatter.
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

## Operating Surfaces

- [[_DASHBOARD]]
- [[_TASKS]]
- [[_ADDENDA]]
- [[_IDEAS]]
- [[_EVENTS]]
- [[_LEDGER]]
- [[_POLICY]]
`;

const DASHBOARD_SEED = `---
type: dashboard
view: analytics
tags: [dashboard, analytics, live]
---

# _DASHBOARD

Open the Sauce Dashboard view for the rich UI. This note remains the
file-native analytics anchor for Dataview, Bases, and static snapshots.

\`\`\`sauce-dql
TABLE title, date, contact, org FROM "notes" SORT date DESC LIMIT 10
\`\`\`
`;

const TASKS_SEED = `---
type: dashboard
view: tasks
tags: [tasks, ledger, live]
---

# _TASKS

\`\`\`sauce-dql
TABLE title, status, priority, due, contact FROM "tasks" SORT due ASC LIMIT 50
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

const IDEAS_SEED = `---
type: dashboard
view: ideas
tags: [ideas, moc, live]
---

# _IDEAS

\`\`\`sauce-dql
TABLE title, stage, impact, next_action, contact, org FROM "ideas" SORT date DESC LIMIT 50
\`\`\`
`;

const EVENTS_SEED = `---
type: dashboard
view: events
tags: [events, calendar, live]
---

# _EVENTS

\`\`\`sauce-dql
TABLE title, date, start, end, contact, org FROM "events" SORT date ASC LIMIT 50
\`\`\`
`;

const LEDGER_SEED = `---
type: dashboard
view: ledger
tags: [ledger, erp, live]
---

# _LEDGER

\`\`\`sauce-dql
TABLE title, date, direction, amount, currency, category, contact, org FROM "ledger" SORT date DESC LIMIT 50
\`\`\`
`;

const POLICY_SEED = `---
type: enterprise-policy
contract: extended
subtype_of: Entity
domain:
  name: sauce.local
  allowed_email_domains: []
roles:
  founder:
    can: [admin, invite, approve, connect-tools, view-upstream-rollups]
  department-lead:
    can: [invite-department, approve-department, view-department-rollups]
  operator:
    can: [capture, edit-owned, request-approval]
  viewer:
    can: [read-assigned]
departments:
  founder-group:
    members: []
    upstream_rollup: domain
data_flow:
  personal: private-by-default
  department: rollup-kpis-only
  domain: policy-approved-summary
approval_rules:
  tool_connection: founder
  upstream_rollup: department-lead
  external_send: operator-confirm
tags: [policy, enterprise, permissions]
---

# _POLICY

This is the file-native enterprise deployment contract. It defines who can
invite users, connect tools, approve Copilot actions, and roll up department
or domain-level summaries.

Use Settings and modal flows to change operating data. Keep this page as the
human-readable policy anchor for audits and deployments.
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
  task_status: [todo, in_progress, blocked, done, cancelled]
  task_priority: [low, medium, high, urgent]
  idea_stage: [seed, shaping, planned, active, shipped, archived]
  pipeline_stage: [prospect, first-touch, discovery, proposal, closed-won, closed-lost]
  observation_signal: [relationship, opportunity, risk, timing, access, pattern]
compat_config:
  rho_adm: 0.5
  fields: [roles, tags, industry, location]
tags: [plugin-config, contract]
---

# _PLUGIN-CONFIG

Edit via the Settings tab.
`;
