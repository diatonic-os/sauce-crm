# Tokens Plan

Status: DRAFTED
Shard: SH-A
Outputs: `packages/ui-tokens/`

## Token Contract

Tokens implement `TOK-001` and are the only approved source for dimensions,
border radius, borders, typography, motion, and interaction color. Component
CSS can consume tokens; product code cannot define ad-hoc spacing or inline
style values.

## Required Exports

| File | Purpose |
|---|---|
| `packages/ui-tokens/src/index.ts` | Typed token object and token name unions. |
| `packages/ui-tokens/src/css.ts` | CSS variable string for injection/build output. |
| `packages/ui-tokens/tokens.css` | Framework-agnostic CSS variables. |
| `packages/ui-tokens/package.json` | Internal package metadata. |

## Canonical Values

```ts
export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  "2xl": 32,
} as const;

export const radius = {
  sm: 4,
  md: 8,
  lg: 12,
} as const;

export const border = {
  width: 1,
  style: "solid",
  color: "var(--border-subtle)",
} as const;
```

## CSS Variable Names

| Token | CSS Variable |
|---|---|
| `spacing.xs` | `--sg-space-xs` |
| `spacing.sm` | `--sg-space-sm` |
| `spacing.md` | `--sg-space-md` |
| `spacing.lg` | `--sg-space-lg` |
| `spacing.xl` | `--sg-space-xl` |
| `spacing.2xl` | `--sg-space-2xl` |
| `radius.sm` | `--sg-radius-sm` |
| `radius.md` | `--sg-radius-md` |
| `radius.lg` | `--sg-radius-lg` |
| `border.color` | `--sg-border-subtle` |

## Obsidian Theme Bindings

`tokens.css` must map canonical tokens onto Obsidian variables:

- `--sg-border-subtle: var(--background-modifier-border)`
- `--sg-surface: var(--background-primary)`
- `--sg-surface-muted: var(--background-secondary)`
- `--sg-text: var(--text-normal)`
- `--sg-text-muted: var(--text-muted)`
- `--sg-accent: var(--interactive-accent)`
- `--sg-accent-hover: var(--interactive-accent-hover)`

## Layout Rules To Encode

- Sections separated by at least `--sg-space-xl`.
- Controls within a row separated by at least `--sg-space-md`.
- Cards padded by `--sg-space-lg`.
- Two bordered elements must not touch. Insert `--sg-space-lg` or collapse one border.

## Acceptance For SH-A Token Step

- Tokens compile as TypeScript.
- `tokens.css` has no product-specific class names.
- No secret or environment data exists in token outputs.
- Existing `styles.css` imports or aliases tokens without deleting old classes until migration.
