# SH-C — Core Plugin Wrappers

**Deps:** SH-A · **Owner:** TBD · **Status:** `TODO`
**Goal:** 4 grouped facades over Obsidian core plugins, full parallel. Canon-aware (no direct modify on canonized files — G-003).
**Children:** SH-C1..C4.

| Task | Shard | Out | Acc | Status |
|------|-------|-----|-----|--------|
| T-C1-01 | SH-C1-files | `src/services/core/FilesService.ts` | unified API over CW-files; canon-aware (route writes via CanonService) | TODO |
| T-C2-01 | SH-C2-search | `src/services/core/SearchService.ts` | unified API over CW-search; typed results | TODO |
| T-C3-01 | SH-C3-content | `src/services/core/ContentService.ts` | unified API over CW-content; web-viewer respects privacy settings | TODO |
| T-C4-01 | SH-C4-meta | `src/services/core/MetaService.ts` | unified API over CW-meta; property writes route through CanonService when canonized | TODO |

**Notes:** SH-C4 has a soft dep on SH-D (CanonService) for the canon-routed property writes; implement against the CanonService interface from SH-D's T-D-01.
