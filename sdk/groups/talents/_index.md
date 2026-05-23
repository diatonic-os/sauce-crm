---
group: talents
summary: Named bundles of skills exposing one agent-facing capability pack.
generated_from: composition of skills/
---

# talents/ — capability packs

A talent is the highest composition tier: a named bundle of skills presented
as one agent-facing capability (the unit a Copilot/agent "has"). Talents hold
no logic beyond declaring their skill set and an activation contract.

## Seed members

| id | bundles (skills/) | platform |
|---|---|---|
| `relationship-intelligence` | research-person, research-org, infer-edges, summarize-thread | [desktop, mobile] |
| `capture` | quick-capture(action), capture-call, transcribe | desktop (transcribe gated) |
| `sync` | run-embedding-sync(action) | [desktop, mobile] |
| `outreach` | route-introduction(action), draft-touch | [desktop, mobile] |
