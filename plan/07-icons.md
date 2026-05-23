# Icon System Plan

Status: DRAFTED
Shard: SH-E
Depends on: SH-A
Outputs: `packages/ui-icons/`

## Current State

Icons are registered through `src/ui/icons/IconRegistry.ts`, with additional
SVG files under `src/ui/icons/svg/`. Some surfaces also use raw Obsidian/Lucide
icon string names.

## Objective

Create a single icon source that exports to React, Svelte, and Obsidian
`addIcon()` registration without divergence.

## Required Files

| File | Purpose |
|---|---|
| `packages/ui-icons/src/icons.ts` | Canonical icon definitions. |
| `packages/ui-icons/src/obsidian.ts` | `registerObsidianIcons(addIcon)` adapter. |
| `packages/ui-icons/src/react.tsx` | React icon component/export map. |
| `packages/ui-icons/src/svelte/` | Svelte icon component/export map. |
| `packages/ui-icons/sprite.svg` | Optional generated sprite. |
| `packages/ui-icons/package.json` | Package metadata. |

## Normalization Rules

- Uniform viewBox.
- Uniform stroke width.
- `currentColor` only.
- Size via tokens/classes, never inline width/height in product code.
- One import path per framework.
- Obsidian icon strings in product code must be constants from icon package.

## Initial Icon Inventory

Custom icons include:

- person
- org
- touch
- addendum
- intro
- promote
- compat
- heatmap
- hierarchy
- overdue
- parent-vault
- copilot
- skill
- audit
- ai-inbox
- map
- sync
- note
- idea
- observation
- task
- event
- ledger
- pipeline

## Acceptance

- React and Svelte icon export maps have identical names.
- Obsidian registry uses the same source map.
- No product file embeds SVG strings after migration.
