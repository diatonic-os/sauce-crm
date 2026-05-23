# Sauce CRM UI System

This document defines the user-interface contract for the Obsidian community
plugin. Markdown remains canonical, but daily work should happen through
commands, ribbon menus, modals, panels, dashboards, and Copilot feeds.

## Surfaces

| Surface | Source | Purpose |
|---|---|---|
| People ribbon | `src/main.ts` | Create people, orgs, touches, intros, and prospect promotion. |
| Graph ribbon | `src/main.ts` | Open dashboard, pipeline, typed graph, compatibility, heatmap, hierarchy, overdue, map, calendar, task, inbox, and ledger views. |
| Copilot ribbon | `src/main.ts` | Open chat, AI inbox, skill picker, audit log, skill run log, and sync status. |
| Setup ribbon | `src/main.ts` | Capture notes, ideas, observations, tasks, events, ledger entries, pipeline deals, addenda, relations, imports, backups, and onboarding. |
| Dashboard view | `src/ui/views/Views.ts` | KPI grid, Copilot feed, touch velocity chart, recent touches, next tasks, ideas, and events. |
| Svelte dashboards | `src/ui/svelte/*.svelte` | Reactive task board, inbox, ledger, and calendar. |
| Capture modal | `src/ui/modals/CaptureRecordModal.ts` | Modal-first authoring for non-contact CRM/ERP records. |

## File-Native Records

| Type | Folder | UI Entry | Required Fields |
|---|---|---|---|
| `warm-contact` | `people/` | Person modal | `primary_type`, `roles`, `closeness`, `cadence` |
| `org` / `subsidiary` | `orgs/` | Org modal | `status`, `industry`, `parent` |
| `touch` | `touches/YYYY/MM/` | Touch modal | `contact`, `date`, `channel`, `attendees` |
| `addendum` | `_addenda/` | Addendum modal | `addends`, `kind`, `date` |
| `knowledge-note` | `notes/` | Capture modal | `title`, `date`, `contact`, `org`, `confidence` |
| `idea` | `ideas/` | Capture modal | `title`, `stage`, `impact`, `next_action` |
| `observation` | `observations/` | Capture modal | `title`, `signal`, `confidence`, `evidence` |
| `task` | `tasks/` | Capture modal and Tasks view | `title`, `status`, `priority`, `due`, `approval_required` |
| `event` | `events/` | Capture modal and Calendar view | `title`, `date`, `start`, `end`, `attendees` |
| `ledger-entry` | `ledger/` | Capture modal and Ledger view | `title`, `date`, `direction`, `amount`, `currency` |
| `pipeline-deal` | `pipeline/` | Capture modal and Pipeline view | `title`, `stage`, `value`, `probability`, `next_action` |

## Design Rules

- Use modal-first capture for structured records. The operator should not need
  to memorize frontmatter keys.
- Preserve Markdown readability. Every modal-created record includes a body
  section plus a `Copilot Feed` checklist for review and enrichment.
- Use Liskov-safe subclasses in `src/domain/`. Subtypes strengthen behavior
  without weakening the base `Entity` contract.
- Keep layout theme-aware. CSS uses Obsidian variables and logical properties
  for RTL readiness.
- Prefer live views over static tables. Open CRM views refresh after vault
  metadata, delete, or rename events.
- Gate risky actions. Tool connection, upstream rollup, external send, and
  package install flows must route through approval policy.

## Enterprise Policy

`_POLICY.md` is the deployment anchor for top-level domain, role, department,
founder group, permission, approval, and upstream rollup rules. Parent vaults
also include an `enterprise_policy` block in `PARENT-VAULT.md`.

Default flow:

| Scope | Default Data Flow |
|---|---|
| Personal | Private by default. |
| Department | KPI summaries roll up to department leads. |
| Domain | Approved summaries roll up to founder or domain admins. |

## Dashboard Expectations

- Morning summary: overdue contacts, pending tasks, and upcoming events.
- Weekly recap: touch velocity, new ideas, new observations, closed tasks,
  and ledger movement.
- Relationship map: people, orgs, touches, pipeline deals, and observations
  should remain queryable by frontmatter and graph edges.
- Copilot sidecar: suggestions should be actionable as approval-thread tasks,
  not hidden in generated prose.
