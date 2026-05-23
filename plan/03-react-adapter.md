# React Adapter Plan

Status: DRAFTED
Shard: SH-B
Depends on: SH-A
Outputs: `packages/ui-react/`

## Current State

No React UI surface exists in this repository. `ASM-001` is false for the
current checkout. The adapter must still ship because the contract requires
React and Svelte parity.

## Implementation Strategy

1. Create `packages/ui-react/`.
2. Import `@sauce-crm/ui-primitives` manifest and prop types.
3. Export every CC-001 component from `src/index.ts`.
4. Keep wrappers thin: class composition, ARIA wiring, event normalization.
5. No business logic, no Obsidian imports, no settings persistence.

## Required Files

| File | Purpose |
|---|---|
| `packages/ui-react/src/index.ts` | Barrel exports. |
| `packages/ui-react/src/components/*.tsx` | One component per manifest entry or grouped by family. |
| `packages/ui-react/src/parity.ts` | Runtime export list for `LINT-PARITY`. |
| `packages/ui-react/package.json` | Package metadata. |
| `packages/ui-react/tsconfig.json` | Build config. |

## Event Semantics

- `onChange(next, event)` fires on every interaction.
- `onCommit(next, event)` fires on blur, Enter, menu select, or explicit apply.
- `loading` disables pointer action and shows `Spinner`.
- `disabled` maps to native disabled where possible and `aria-disabled`.

## Acceptance

- All CC-001 names exported.
- Prop types match Svelte adapter manifest.
- No inline styles.
- No Obsidian dependency.
- Example render works in VR harness.
