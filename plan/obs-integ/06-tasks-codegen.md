# SH-F — Tasks API Auto-Enumeration

**Deps:** SH-B1-tasks · **Owner:** TBD · **Status:** `BLOCKED` (A-005/A-006 — obsidian CLI disabled)
**Goal:** runtime introspect → schemas/obsidian-tasks.json → sdk/generated/tasks.ts → CI gate.

| Task | Out | Acc | Status |
|------|-----|-----|--------|
| T-F-01 | `sdk/generator/introspect-tasks.ts` | runs via `obsidian eval` against live vault; dumps apiV1 shapes + filter/sort/group/display; writes `schemas/obsidian-tasks.json` sorted-deterministic | BLOCKED |
| T-F-02 | `sdk/generated/tasks.ts` | typed wrappers + Filter/Sort/Group/Display unions from schema; sdk:check passes clean | TODO (gen blocked) |
| T-F-03 | `.github/workflows/ci.yml` | adds `npm run sdk:check` step; fails PR on stale tasks.ts | TODO |

**Notes:** Hard-blocked by BLOCKER-2 (CLI). Follows existing `sdk:gen` separate-CLI pattern (A-007). STOP-104 on apiV1 drift after lock.
