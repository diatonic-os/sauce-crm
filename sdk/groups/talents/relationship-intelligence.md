---
group: talents
id: relationship-intelligence
summary: Capability pack bundling relationship skills into one agent-facing talent.
platform: [desktop, mobile]
obsidian_api: none
api_version: "1.8.0"
inputs:
  relationshipIntelligence: "Talent { id, name, skills }"
  analyzeRelationships: "(cache: MetadataCache, file: TFile, subject: string) => RelationshipAnalysis"
outputs: "RelationshipAnalysis { subject, edges, degree }"
side_effects: none
deterministic: true
depends_on: [skills/infer-edges]
---

# talents/relationship-intelligence

The highest composition tier: a named bundle of skills presented as one
agent-facing capability (the unit a Copilot "has"). Currently bundles
`infer-edges`; grows to `research-person`, `research-org`, `summarize-thread`
as those skills land — the `skills` list is the contract a Copilot reads to
know what this talent can do.

## Contract
- `relationshipIntelligence.skills` enumerates the bundled skill ids (every id
  must correspond to an implemented `skills/` member).
- `analyzeRelationships(cache, file, subject)` runs the bundle's analysis
  (currently `infer-edges`) and returns `{ subject, edges, degree }`.
- Deterministic given cache state; no side effects (read-only analysis).
