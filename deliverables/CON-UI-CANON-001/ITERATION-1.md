# CON-UI-CANON-001 Iteration 1

Status: COMPLETE

## Completed

- Audited current UI, settings, icons, commands, views, modals, and markdown processors.
- Wrote `plan/00-audit.md`.
- Wrote token, primitive, React adapter, Svelte adapter, settings-core,
  settings-md, icon, migration, and verification plans.
- Wrote `settings/home.md` scaffold using Markdown plus `settings` blocks.
- Wrote `prompt.md` for future shard execution.

## Key Branch Decision

`ASM-001` is false in the current checkout: Svelte exists, React does not.
The plan therefore creates `packages/ui-react/` from the same primitive
contract rather than migrating an existing React surface.

## Not Done In This Iteration

- No code migration.
- No packages created.
- No VR baselines.
- No settings renderer implementation.

## Next Iteration

Start SH-A:

1. Create `packages/ui-tokens/`.
2. Create `packages/ui-primitives/`.
3. Add parity manifest consumed by React and Svelte adapter plans.
4. Add initial static guardrail checks for inline styles and adapter parity.
