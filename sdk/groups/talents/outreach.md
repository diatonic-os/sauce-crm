---
group: talents
id: outreach
summary: Capability pack bundling intro-routing for outreach planning.
platform: [desktop, mobile]
obsidian_api: none
api_version: "1.8.0"
deterministic: true
depends_on: [chainers/intro-routing]
---

# talents/outreach

Agent-facing capability pack for outreach. Bundles `intro-routing`; grows to
`draft-touch` as that lands.

## Contract
- `outreach.skills` enumerates the bundled capabilities (`intro-routing`).
- `analyzeOutreach(cache, file, subject)` returns `{ subject, ranked }` where
  `ranked` is the scored intro-routing edge list. Deterministic; read-only.
