# Verification Plan

Status: DRAFTED
Shard: SH-H / SH-V
Outputs: `tools/vr/`, `deliverables/CON-UI-CANON-001/FINAL.md`

## Required Linters

| Linter | Scope | Blocking |
|---|---|---|
| `LINT-TOUCH` touch-border | Built CSS plus rendered DOM snapshots | yes |
| `LINT-DEAD` dead-handler | settings blocks, commands, UI event handlers | yes |
| `LINT-PARITY` adapter-parity | `packages/ui-react`, `packages/ui-svelte` | yes |
| `LINT-INLINE` no-inline-style | `src/`, `packages/`, `settings/` rendered output | yes |

## Visual Regression Harness

Use Playwright plus pixelmatch.

Required baselines:

- every primitive component in React
- every primitive component in Svelte
- settings home page
- one migrated settings page from each group
- representative modal
- representative dashboard
- ribbon menu
- dark and light Obsidian theme variable contexts

Threshold: 2px / 0.1% delta.

## Dead Handler Scan

A handler passes only if static or runtime tracing reaches one of:

- settings-core persistence write
- secure store write
- domain service mutation
- command execution with non-placeholder implementation

Notice-only command handlers fail unless explicitly documentation-only.

## Inline Style Scan

Block:

- `style=` in `.svelte`, `.tsx`, `.ts`, `.md` rendered settings blocks
- `.style.` in product TS
- dynamic CSS string construction outside token and primitive packages

Allowed:

- generated VR fixture style isolation
- token package CSS variable definitions
- adapter internals when values reference tokens only

## Touch Border Scan

Render DOM snapshots and fail if two bordered elements are adjacent without
computed margin/gap of at least `spacing.lg`.

Initial implementation can start with static class heuristics, then graduate
to Playwright computed layout checks.

## FINAL.md Contents

`deliverables/CON-UI-CANON-001/FINAL.md` must include:

- surfaces audited
- surfaces migrated
- surfaces deleted
- remaining blockers
- React/Svelte parity table
- settings key registry count
- Markdown settings page count
- linter results
- VR diff summary
- files changed summary
- explicit STOP signal fired

## First Iteration Verification

For IT-001, verification is limited to:

- all plan files exist
- `settings/home.md` exists
- `prompt.md` exists
- no secrets in plan/settings scaffold
- commit contains only plan/settings/prompt/deliverable scaffold files
