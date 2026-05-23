# CON-UI-CANON-001 Audit

Status: ITERATION-1 COMPLETE
Scope: inventory only. No migration performed in this iteration.

## Repository Layout Findings

| Check | Result | Plan Impact |
|---|---|---|
| Plugin repo root | `plugin/` is the Git repo. Parent `sauce-graph/` is not a Git repo. | Commit planning artifacts from `plugin/` only. |
| Existing framework surface | Svelte exists under `src/ui/svelte/`. React does not exist. | `ASM-001` is false as written; create `packages/ui-react/` and `packages/ui-svelte/` from a shared contract. |
| Existing settings implementation | Settings render from TypeScript via Obsidian `Setting` in `src/ui/settings/sections/*.ts`. | `settings-core` and `settings-md` must wrap existing keys before migration. |
| Markdown settings renderer | No settings Markdown renderer exists. Markdown code-block processors exist for `sauce-button` and `sauce-dql`. | Add `packages/settings-md/` with a dedicated parser/renderer. |
| Design system | Current CSS is global `styles.css` with `sauce-*` and `sg-*` classes. | Extract tokens and primitives before migrating surfaces. |
| Dirty worktree | Pre-existing backend/UI/LanceDB changes are present. | Do not include unrelated changes in this contract commit. |

## Registered Touch Surfaces

### Ribbon Menus

| Surface | Source | Status |
|---|---|---|
| People ribbon | `src/main.ts` | migrate |
| Graph and views ribbon | `src/main.ts` | migrate |
| Copilot and AI ribbon | `src/main.ts` | migrate |
| Setup and data ribbon | `src/main.ts` | migrate |

### Commands

Source: `src/main.ts`

Current command surface includes entity creation, views, Copilot, skills,
sync, backup, import/export, federation, validation, cache rebuild, path query,
and fuzzy search commands. All command handlers must be routed through canonical
library buttons/menus where they are visible, and any no-op commands must be
classified during migration.

Known no-op or weak-handler candidates:

| Command | Current Behavior | Required Action |
|---|---|---|
| `sauce:capture-call` | Notice only. | Wire to settings-integrations action or mark deferred. |
| `sauce:transcribe-file` | Notice only. | Wire to file picker or mark deferred. |
| `sauce:rotate-keys` | Notice only. | Wire to security page action. |
| `sauce:import` | Notice only. | Route to import modal/page. |
| `sauce:backup-now` | Notice only. | Route to backup service. |
| `sauce:reseed-backend` | Notice only. | Route to guarded backend action. |
| `sauce:run-inference-pass` | Notice only. | Route to inference service. |
| `sauce:reload-cdel-idioms` | Notice only. | Route to CDEL registry reload. |
| `rebuild-cache` | Notice only. | Route to actual cache invalidation or remove. |
| `run-path-query` | Notice only. | Replace with DQL modal or documented non-action. |
| `fuzzy-search` | Notice only. | Replace with search modal/view. |

### Views

| View | Source | Framework | Status |
|---|---|---|---|
| Dashboard | `src/ui/views/Views.ts` | raw Obsidian DOM | migrate |
| Pipeline Kanban | `src/ui/views/Views.ts` | raw Obsidian DOM | migrate |
| Typed-edge graph | `src/ui/views/Views.ts` | canvas/raw DOM | migrate shell; keep canvas renderer behind primitive container |
| Compatibility matrix | `src/ui/views/Views.ts` | raw Obsidian DOM with inline styles | migrate |
| Touch heatmap | `src/ui/views/Views.ts` | raw Obsidian DOM | migrate |
| Hierarchy tree | `src/ui/views/Views.ts` | raw Obsidian DOM | migrate |
| Overdue queue | `src/ui/views/Views.ts` | raw Obsidian DOM | migrate |
| Parent dashboard | `src/ui/views/Views.ts` | raw Obsidian DOM | migrate |
| Copilot chat | `src/ui/views/v2/CopilotChatView.ts` | raw Obsidian DOM | migrate |
| Calendar | `src/ui/views/v2/CalendarView.ts`, `src/ui/svelte/Calendar.svelte` | Svelte | migrate to `packages/ui-svelte` primitives |
| Tasks board | `src/ui/views/v2/DashboardViews.ts`, `src/ui/svelte/TasksDashboard.svelte` | Svelte | migrate |
| Inbox | `src/ui/views/v2/DashboardViews.ts`, `src/ui/svelte/InboxDashboard.svelte` | Svelte | migrate |
| Ledger | `src/ui/views/v2/DashboardViews.ts`, `src/ui/svelte/LedgerDashboard.svelte` | Svelte | migrate |
| Map real/stub | `src/ui/views/v2/MapView*.ts` | raw Obsidian DOM | migrate |
| AI inbox real/stub | `src/ui/views/v2/AIInboxView*.ts` | raw Obsidian DOM | migrate |
| Sync status real/stub | `src/ui/views/v2/SyncStatusView*.ts` | raw Obsidian DOM | migrate |
| Audit log real/stub | `src/ui/views/v2/AuditLogView*.ts` | raw Obsidian DOM | migrate |
| Skill run log real/stub | `src/ui/views/v2/SkillRunLogView*.ts` | raw Obsidian DOM | migrate |

### Modals

| Modal | Source | Status |
|---|---|---|
| Person | `src/ui/modals/PersonModal.ts` | migrate |
| Org | `src/ui/modals/OrgModal.ts` | migrate |
| Touch | `src/ui/modals/TouchModal.ts` | migrate |
| Addendum | `src/ui/modals/AddendumModal.ts` | migrate |
| Intro | `src/ui/modals/IntroModal.ts` | migrate |
| Relation | `src/ui/modals/RelationModal.ts` | migrate |
| Tag | `src/ui/modals/TagModal.ts` | migrate |
| Promote prospect | `src/ui/modals/PromoteProspectModal.ts` | migrate |
| Register SubVault | `src/ui/modals/RegisterSubVaultModal.ts` | migrate |
| Capture record | `src/ui/modals/CaptureRecordModal.ts` | migrate |
| Approval | `src/ui/modals/ApprovalModal.ts` | migrate |
| LanceDB install | `src/ui/modals/LanceDBInstallModal.ts` | migrate |
| Community plugins | `src/ui/modals/CommunityPluginsModal.ts` | migrate |
| Quick capture | `src/ui/modals/v2/QuickCaptureModal.ts` | migrate |
| Import mapping | `src/ui/modals/v2/ImportMappingModal.ts` | migrate |
| Integration credentials | `src/ui/modals/v2/IntegrationCredentialsModal.ts` | migrate |
| Onboarding wizard | `src/ui/modals/v2/OnboardingWizardModal.ts` | migrate |
| Skill picker | `src/ui/modals/v2/SkillPickerModal.ts` | migrate shell and item rows |
| Conflict | `src/ui/modals/v2/ConflictModal.ts` | migrate |
| Wikilink suggest | `src/ui/modals/WikilinkSuggest.ts` | keep adapter around Obsidian native suggest modal |

### Settings Pages

Current settings control plane is split across:

- `src/ui/settings/SauceGraphSettingTab.ts`
- `src/ui/settings/sections/basic.ts`
- `src/ui/settings/sections/vault.ts`
- `src/ui/settings/sections/contracts.ts`
- `src/ui/settings/sections/copilot.ts`
- `src/ui/settings/sections/skills.ts`
- `src/ui/settings/sections/integrations.ts`
- `src/ui/settings/sections/data.ts`
- `src/ui/settings/sections/advanced.ts`
- legacy/page classes under `src/ui/settings/*.ts`
- integration pages under `src/ui/settings/integrations/*.ts`

Status: migrate all settings content to `settings/*.md` rendered through
`packages/settings-md/`, backed by registered keys in `packages/settings-core/`.

### Icons

| Source | Status |
|---|---|
| `src/ui/icons/IconRegistry.ts` inline SVG registry | migrate |
| `src/ui/icons/svg/*.svg` source files | consolidate into sprite source |
| Obsidian/Lucide icon string usage in `main.ts` | audit and normalize |

### Markdown Processors

| Processor | Source | Status |
|---|---|---|
| `sauce-button` | `src/main.ts`, `src/ui/widgets/ActionButton.ts` | migrate to primitive Button renderer |
| `sauce-dql` | `src/main.ts` | keep backend query behavior, migrate result UI |

## Guardrail Findings

| Guardrail | Current Result | Blocking For Migration |
|---|---|---|
| `GR-001` no inline styles | Failing. Inline `style=` in Svelte and `.style.*` in TS views/settings. | Yes |
| `GR-002` React/Svelte parity | Failing. Svelte exists; React adapter absent. | Yes |
| `GR-003` every setting registered | Failing. Settings write directly to plugin object. | Yes |
| `GR-004` lint/VR gating | Failing. No VR harness or custom linters yet. | Yes |
| `GR-005` no secrets in plan | Passing for this audit. | Continue enforcing. |
| `GR-006` no improvisation | Passing. Unknown surfaces are listed here. | Continue enforcing. |

## First Migration Order

1. Build `packages/ui-tokens/` and `packages/ui-primitives/`.
2. Build parity adapters with one no-business-logic demo component per CC-001 component.
3. Build settings registry and Markdown renderer.
4. Migrate settings home page first.
5. Migrate low-risk reusable surfaces: buttons, cards, banners, section rows.
6. Migrate modals and settings pages.
7. Migrate views.
8. Add visual regression baselines and blocking linters.
