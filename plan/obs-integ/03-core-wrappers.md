# SH-C — Core Plugin Wrappers

**Deps:** SH-A · **Owner:** orchestrator · **Status:** `DONE` (4 services; 450 tests green)
**Goal:** 4 grouped facades over Obsidian core plugins, full parallel. Canon-aware (no direct modify on canonized files — G-003).
**Children:** SH-C1..C4.

| Task | Shard | Out | Acc | Status |
|------|-------|-----|-----|--------|
| T-C1-01 | SH-C1-files | `src/services/core/FilesService.ts` | unified API over CW-files; canon-aware (route writes via CanonService) | **DONE** |
| T-C2-01 | SH-C2-search | `src/services/core/SearchService.ts` | unified API over CW-search; typed results | **DONE** |
| T-C3-01 | SH-C3-content | `src/services/core/ContentService.ts` | unified API over CW-content; web-viewer respects privacy settings | **DONE** |
| T-C4-01 | SH-C4-meta | `src/services/core/MetaService.ts` | unified API over CW-meta; property writes route through CanonService when canonized | **DONE** |

**Notes:** Canon-awareness implemented via an injected `CanonGuard` interface (defined in FilesService.ts: `isCanonized` + `mutateViaContract`) — SH-D's CanonService satisfies it structurally, keeping SH-C independent of SH-D (both deps:[SH-A]). G-003 enforced + tested: FilesService.updateViaContract and MetaService.setProperty/removeProperty never call raw modify on a canonized path. ContentService.fetchWeb gated by injected PrivacyGate. All services use injected hosts → vitest-testable without a live app.
