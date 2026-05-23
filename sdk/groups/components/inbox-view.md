---
group: components
id: inbox-view
summary: Headless inbox list — pending-item rows styled only via cssTokens.
platform: [desktop, mobile]
obsidian_api: none
api_version: "1.8.0"
deterministic: true
depends_on: [generator/emit-css-tokens]
---

# components/inbox-view

Headless AI-inbox list: rows of pending items (title + optional subtitle), every
style value a `var(--token)` (zero literals). Placed via `tools/workspace-get-leaf`.

## Contract
- `renderInbox(doc, items)` → `<div.sauce-inbox>` with one `.sauce-inbox__item`
  per item; empty items → an empty-state row.
- Deterministic input order; zero-literals styling.
