---
group: components
id: touch-timeline
summary: Headless touch-timeline — ordered touch rows styled only via cssTokens.
platform: [desktop, mobile]
obsidian_api: none
api_version: "1.8.0"
deterministic: true
depends_on: [generator/emit-css-tokens]
---

# components/touch-timeline

Headless timeline of touch events (tick + channel + optional summary), rendered
in the given order, every style value a `var(--token)` (zero literals).

## Contract
- `renderTouchTimeline(doc, touches)` → `<div.sauce-touch-timeline>` with one
  `.sauce-touch-row` per touch (channel + optional summary).
- Deterministic: rows follow input order. Zero-literals styling.
