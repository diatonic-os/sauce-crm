# Settings Markdown Plan

Status: DRAFTED
Shard: SH-D / SH-G
Depends on: SH-A, settings-core, adapters
Outputs: `packages/settings-md/`, `settings/*.md`

## Objective

Render every settings page from Markdown files containing documentation and
fenced `settings` blocks.

## Source Directory

All settings pages live under `settings/`.

Initial files:

- `settings/home.md`
- `settings/general.md`
- `settings/vault.md`
- `settings/validation.md`
- `settings/copilot.md`
- `settings/skills.md`
- `settings/integrations.md`
- `settings/data.md`
- `settings/advanced.md`

## Block Format

````md
```settings
type: toggle
key: features.experimental
label: Enable experimental features
description: Unstable, may break.
default: false
```
````

## Parser Rules

- Unknown block type is a build error.
- Missing `key` is a build error for interactive block types.
- Unknown registry key is a build error.
- Markdown outside `settings` blocks renders as documentation.
- Every block has deterministic `data-testid`.

## Renderer Rules

- Render pages through UI library primitives only.
- No bespoke settings components.
- Settings rows follow `LAY-001`: label-left, description-below-label,
  control-right, helper text below control.
- Home page is pure Markdown plus settings blocks.

## Required Files

| File | Purpose |
|---|---|
| `packages/settings-md/src/parser.ts` | Markdown scanner and settings block extractor. |
| `packages/settings-md/src/schema.ts` | Block schema. |
| `packages/settings-md/src/render.ts` | Framework-independent render model. |
| `packages/settings-md/src/validate.ts` | Build-time validation. |
| `packages/settings-md/package.json` | Package metadata. |

## Home Page Contract

`settings/home.md` must include:

- welcome banner
- about/readme
- what is new from `CHANGELOG.md` tail if present
- quick links to settings pages
- no bespoke component imports

## Migration Rule

Existing TypeScript settings sections remain until a Markdown page reaches
parity. Each migrated page must delete or bypass its old TS renderer in the
same migration task.
