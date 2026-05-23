---
group: chainers
id: intro-routing
summary: Score a contact's edges for introduction routing (worked_with > knows).
platform: [desktop, mobile]
obsidian_api: none
api_version: "1.8.0"
deterministic: true
depends_on: [skills/infer-edges, helpers/stable-sort]
---

# chainers/intro-routing

Composes `skills/infer-edges`, scores each edge by type
(`worked_with`=2, `knows`=1), and returns them ranked by score desc, ties by
`to` asc (stable, deterministic).

## Contract
- `routeIntro(cache, file, subject)` → `ScoredEdge[]` sorted by score desc then
  `to` asc. Deterministic given cache state; no side effects.
