# Svelte Adapter Plan

Status: DRAFTED
Shard: SH-C
Depends on: SH-A
Outputs: `packages/ui-svelte/`

## Current State

Svelte dashboards already exist under `src/ui/svelte/`, but they directly use
HTML controls and local `<style>` blocks. These are product surfaces, not a
shared component library.

## Implementation Strategy

1. Create `packages/ui-svelte/`.
2. Import the same primitive manifest and prop types used by React.
3. Export every CC-001 component from `src/index.ts`.
4. Keep component class names and ARIA semantics identical to React.
5. Migrate existing Svelte dashboards only after adapter parity passes.

## Required Files

| File | Purpose |
|---|---|
| `packages/ui-svelte/src/index.ts` | Barrel exports. |
| `packages/ui-svelte/src/components/*.svelte` | One component per manifest entry or grouped by family. |
| `packages/ui-svelte/src/parity.ts` | Runtime export list for `LINT-PARITY`. |
| `packages/ui-svelte/package.json` | Package metadata. |
| `packages/ui-svelte/svelte.config.js` | Svelte package config if needed. |

## Slot Semantics

Svelte slot/snippet names must match React slot names:

- default content maps to React `children`.
- `leading` maps to React `leading`.
- `trailing` maps to React `trailing`.
- menu item content maps to React `children`.

## Existing Svelte Surfaces To Migrate

- `src/ui/svelte/Calendar.svelte`
- `src/ui/svelte/TasksDashboard.svelte`
- `src/ui/svelte/InboxDashboard.svelte`
- `src/ui/svelte/LedgerDashboard.svelte`

## Acceptance

- All CC-001 names exported.
- Prop names match React.
- No local product styles in migrated dashboards.
- No inline `style=` in migrated dashboards.
