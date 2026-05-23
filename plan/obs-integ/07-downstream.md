# SH-G — Downstream Inheritance

**Deps:** SH-B, SH-C, SH-D, SH-E · **Owner:** TBD · **Status:** `TODO`
**Goal:** public svcV1 + DownstreamRegistry + docs/services-api.md.

| Task | Out | Acc | Status |
|------|-----|-----|--------|
| T-G-01 | `src/services/SauceServiceAPI.ts` | mounted at `app.plugins.plugins['sauce-crm'].svcV1`; exposes all SVC-* facades; semver-locked 0.3.0 (DEC-012) | TODO |
| T-G-02 | `src/services/DownstreamRegistry.ts` | registerEntity/registerTouchSource/registerPipeline/registerView + negotiateVersion; rejects incompatible callers | TODO |
| T-G-03 | `docs/services-api.md` | published API contract; example downstream plugin; versioning policy DEC-012 (R-004) | TODO |

**Notes:** G-010 — no facade returns a raw Obsidian API handle. svcV1 frozen at manifest bump 0.2.0→0.3.0.
