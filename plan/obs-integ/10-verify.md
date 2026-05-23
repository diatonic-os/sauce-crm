# SH-V — Verify (forced join)

**Deps:** SH-F, SH-G, SH-I · **Owner:** orchestrator · **Status:** `TODO`
**Goal:** acceptance matrix + FINAL.md. No bypass (forced_join).

| Task | Out | Acc | Status |
|------|-----|-----|--------|
| T-V-01 | `deliverables/CON-OBS-INTEG-001/ACCEPTANCE.md` | every shard's acc box checked; lint+typecheck+vitest+sdk:check green | TODO |
| T-V-02 | `deliverables/CON-OBS-INTEG-001/FINAL.md` | summary + manifest delta 0.2.0→0.3.0 + entity catalog + integration matrix + sponsor block | TODO |

**Stop signals:** STOP-101 (all green → FINAL.md, halt) · STOP-102 (3 idle iters → BLOCKERS.md) · STOP-103 (guardrail → block shard only).
