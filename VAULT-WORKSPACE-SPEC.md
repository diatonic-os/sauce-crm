# Sauce CRM — Vault Workspace Spec (PROPOSED, needs operator lock)

Sauce CRM is the **orchestrator** of the vault. Source of truth = the vault's
`.md` files; LanceDB is the derived index/memory; the `_`-folders below are the
*workspace surfaces* the plugin renders and maintains. Entity content
(`people/`, `orgs/`, `touches/`) is unchanged; this spec defines the nine
underscore folders.

Legend: **Index note** = a `_<folder>/_index.md` (or folder note) carrying a
`sauce-<kind>` code block the plugin renders into a live view. Several map
directly to views that already exist.

| Folder | Purpose | What renders (index note → view) | Backed by |
|---|---|---|---|
| **`_addenda/`** *(canon)* | Append-only annotations on entities + copilot sessions + audit | Timeline list: date · kind (correction/enrichment/context) · target `[[entity]]` · author; sub-roots `_copilot/` (chat sessions), `_audit-YYYY-MM-DD.md`, `_transcripts/` | EntityService.allAddenda(), ConversationStore |
| **`_dashboard/`** | CRM home / at-a-glance | KPI cards (people/orgs/touches counts, overdue, due-this-week), quick actions, recent activity | **DashboardView** (exists) |
| **`_events/`** | Time-driven feed | Calendar + chronological event feed: touches by date, scheduled follow-ups, integration calendar events | **CalendarView** (exists) + touches + integration events |
| **`_ledger/`** | Value-exchange ledger | Per-contact in/out/net rollups + full entry list (date/contact/category/direction/amount) | **LedgerView** (exists) |
| **`_moc/`** | Maps of Content | Auto-generated index notes linking entity clusters/communities (graphify communities); one MOC per cluster | graphify communities + edges |
| **`_Plugin-Config/`** | Plugin auto-config state | Table: each supported core/community plugin → state (not-installed / installed / configured / drift) + the canonical settings Sauce applies + "re-apply" / "fix drift" actions | **new PluginConfigService** + Obsidian `app.plugins` / `internalPlugins` |
| **`_Policy/`** | Governance | Contract rules, validation strictness, scopes, autonomy policy, locked DEC decisions | ContractValidator config + ScopeRegistry + settings |
| **`_Readme/`** | Onboarding / help | Static help: vault conventions, folder map, getting-started, command reference (mostly authored MD) | static, seeded by bootstrapper |
| **`_Tasks/`** | Task management | Task board grouped by status (todo / in_progress / blocked / done / cancelled), priority, due, `[[contact]]` link; **emitted in the Tasks community-plugin checkbox format** so that plugin's queries pick them up | **TasksView** (exists) + Tasks-plugin format |

## Plugin auto-configuration (the `_Plugin-Config` engine)

Sauce decomposes the work the way "Copilot for Obsidian" does for chat, but for
*vault orchestration*: when the operator installs a **supported** plugin, Sauce
hooks it and applies the canonical settings needed to work inside our structure.

- **Detection:** on `workspace.onLayoutReady` + a light poll, read
  `app.plugins.manifests` / `enabledPlugins` and `internalPlugins`. (Obsidian has
  no public "plugin installed" event for community plugins → poll/diff.)
- **State machine per plugin:** `unsupported → not-installed → installed
  (unconfigured) → configured → drift (settings changed away from canon)`.
- **Auto-config:** write the plugin's `data.json` (community) or
  `internalPlugins/<id>/data.json` (core) to the canonical Sauce profile, with a
  **backup + provenance trace** before each write (reuse the ProvenanceService).
- **Targets (proposed):** core — Daily Notes, Templates, Backlinks, Page Preview,
  Outgoing Links; community — **Tasks**, **Dataview** (renders our `sauce-*`
  blocks fallback), **Templater**, **Calendar**.
- **Community app / REST + webhooks:** a separate connector that the
  `_Plugin-Config` surface exposes — pull data, register webhooks, call the REST
  API. (Underspecified — see fork Q4.)

## Build waves (decomposition)

| Wave | Scope | Depends on |
|---|---|---|
| **W1** | Bootstrap the 9 folders + seed `_index.md` / `_Readme` content (extend VaultBootstrapper) | — |
| **W2** | Folder index renderers: wire existing views (`_dashboard`/`_events`/`_ledger`/`_Tasks`) as folder index code blocks; add `_addenda` timeline + `_moc` generator | W1 |
| **W3** | `PluginConfigService`: detect → state machine → auto-config (backup+provenance) + `_Plugin-Config` dashboard | W1 |
| **W4** | Tasks ↔ Tasks-community-plugin format integration (states, due, queries) | W2, W3 |
| **W5** | Community-app connector: REST + webhooks pull/push | W3 |

## Genuine forks — need your call before W3+

1. **Auto-config aggressiveness** — silently apply canonical settings on install, or *propose* a diff and apply on operator approval? (Writing another plugin's `data.json` is invasive.)
2. **Supported-plugin set** — confirm the core + community targets above; add/remove any.
3. **Tasks representation** — Sauce Task entities rendered *as* Tasks-plugin checkboxes in `_Tasks` notes (so the Tasks plugin owns querying), or Sauce owns the board and merely mirrors to Tasks format?
4. **Community app / REST + webhooks** — which app/endpoints? This is the least-specified piece; needs a target API + auth model before W5.

## Status
- ✅ Copilot session persistence wired (`_addenda/_copilot/`) — commit `736460c`.
- ⬜ Everything above is **proposed** — awaiting operator lock on the forks before building W1+.
