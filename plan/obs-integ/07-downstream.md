# SH-G — Downstream Inheritance

**Deps:** SH-B, SH-C, SH-D, SH-E · **Owner:** orchestrator · **Status:** `DONE` (501 tests green; SVC-api complete)
**Goal:** public svcV1 + DownstreamRegistry + docs/services-api.md.

| Task | Out | Acc | Status |
|------|-----|-----|--------|
| T-G-01 | `src/services/SauceServiceAPI.ts` (+ `src/services/EventBus.ts`) | mounted at `app.plugins.plugins['sauce-crm'].svcV1`; exposes all SVC-* facades; semver-locked 0.3.0 (DEC-012) | **DONE** |
| T-G-02 | `src/services/DownstreamRegistry.ts` | registerEntity/registerTouchSource/registerPipeline/registerView + negotiateVersion; rejects incompatible callers | **DONE** |
| T-G-03 | `docs/services-api.md` | published API contract; example downstream plugin; versioning policy DEC-012 (R-004) | **DONE** |

**Notes:** `buildSvcV1(deps)` composes a **frozen** svcV1 from the SH-B..E services; G-010 verified — entities/touches/pipelines are read facades over GraphService (plain data, no raw handle), and a test asserts no `.app`/`.vault` member. `EventBus` (SVC-events) created here (its own file) since the `events` facade needs it — **scope note:** EventBus.ts is beyond T-G-01's literal `out` but is the named SVC-events module the facade requires. DownstreamRegistry.negotiateVersion uses a minimal semver (`satisfies`) — exact/`*`/`>=`/`^` (0.x caret pins minor). **Lint-gate note:** `npm run lint` currently shows **1 prettier error** in `src/ui/MobileStyles.ts` — an **untracked operator WIP file**, NOT contract code; all SH-G files pass `eslint` individually (exit 0). Left untouched per "don't modify files you didn't create."
