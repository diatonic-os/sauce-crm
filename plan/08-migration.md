# Surface Migration Plan

Status: DRAFTED
Shard: SH-F / SH-G
Depends on: SH-B, SH-C, SH-D, SH-E

## Migration Principles

- Do not change backend schema or business behavior.
- Replace UI shell, controls, layout, and styling only.
- Delete inline styles while preserving functionality.
- Use the UI library for every touchable control.
- Unknown surface becomes a new task entry, not an improvised component.

## Phase 1: Low-Risk Shared Components

| Task | Files | Done When |
|---|---|---|
| M1.1 Buttons | `src/ui/modals/**/*.ts`, `src/ui/views/**/*.ts`, Svelte dashboards | No raw button classes outside adapters. |
| M1.2 Cards/sections | Views and settings sections | All bordered containers use `Card` or `Section`. |
| M1.3 Banners/callouts | first-run, onboarding, empty states | All status surfaces use `Banner`, `Callout`, `EmptyState`, or `ErrorState`. |
| M1.4 Menus | ribbon menu builders | Menu rows use canonical menu item contract. |

## Phase 2: Settings Migration

| Task | Source | Target |
|---|---|---|
| M2.1 Home | new | `settings/home.md` |
| M2.2 Basic | `src/ui/settings/sections/basic.ts` | `settings/general.md` |
| M2.3 Vault | `src/ui/settings/sections/vault.ts` | `settings/vault.md` |
| M2.4 Contracts | `src/ui/settings/sections/contracts.ts` | `settings/validation.md` |
| M2.5 Copilot | `src/ui/settings/sections/copilot.ts` | `settings/copilot.md` |
| M2.6 Skills | `src/ui/settings/sections/skills.ts` | `settings/skills.md` |
| M2.7 Integrations | `src/ui/settings/sections/integrations.ts` and integration pages | `settings/integrations.md` plus child pages |
| M2.8 Data | `src/ui/settings/sections/data.ts` | `settings/data.md` |
| M2.9 Advanced | `src/ui/settings/sections/advanced.ts` | `settings/advanced.md` |

## Phase 3: Modal Migration

| Group | Files |
|---|---|
| Entity CRUD | `PersonModal`, `OrgModal`, `TouchModal`, `AddendumModal`, `CaptureRecordModal` |
| Relationship ops | `IntroModal`, `RelationModal`, `PromoteProspectModal`, `TagModal` |
| Federation/data | `RegisterSubVaultModal`, `ImportMappingModal`, `CommunityPluginsModal` |
| Security/approval | `ApprovalModal`, `LanceDBInstallModal`, `IntegrationCredentialsModal`, `ConflictModal` |
| Assistant | `QuickCaptureModal`, `SkillPickerModal`, `OnboardingWizardModal` |

## Phase 4: View Migration

| Group | Files |
|---|---|
| Classic views | `src/ui/views/Views.ts` split into one file per view |
| Svelte dashboards | `Calendar.svelte`, `TasksDashboard.svelte`, `InboxDashboard.svelte`, `LedgerDashboard.svelte` |
| V2 operational views | `CopilotChatView`, `AIInboxView`, `MapView`, `SyncStatusView`, `AuditLogView`, `SkillRunLogView` |

## Phase 5: Delete/Consolidate

- Delete one-off components replaced by primitives.
- Delete local Svelte `<style>` blocks after class migration.
- Delete unused legacy settings page classes or convert them to Markdown pages.
- Delete duplicated real/stub views once registry can express degraded states.

## Migration Task Template

Each migration task must record:

- surface name
- source file
- current controls
- destination primitive components
- settings keys touched
- handler proof
- VR baseline path
- linter results
