---
group: components
summary: Svelte UI building blocks bound strictly to CSS-variable tokens (zero hardcoded styles).
generated_from: Reference/CSS variables + Reference/TypeScript API (ItemView/Modal/Setting)
---

# components/ — UI atoms (Svelte + CSS variables)

Build target now includes Svelte (`esbuild-svelte`). Every component imports
design tokens from `sdk/generated/css-tokens.ts` — **no literal colors, sizes,
or fonts**. Mobile components honor `WorkspaceMobileDrawer` and safe-area insets.

## Seed members

| id | obsidian_api | platform |
|---|---|---|
| `crm-card` | `Component` | [desktop, mobile] |
| `touch-timeline` | `ItemView` | [desktop, mobile] |
| `inbox-view` | `ItemView` | [desktop, mobile] |
| `person-modal` | `Modal` | [desktop, mobile] |
| `setting-row` | `Setting` | [desktop, mobile] |
| `map-view` | `ItemView` | desktop (heavy; mobile-lite fallback) |

## Style contract
- Tokens only, from the generated map (source: `Reference/CSS variables/**`).
- Respect light/dark via Obsidian theme vars; never read OS theme directly.
