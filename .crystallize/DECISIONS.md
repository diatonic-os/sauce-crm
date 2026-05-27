# Crystallization Decision Register

Append-only. Only `locked` decisions are binding (per DUSA contract).
Scope: `sauce-crm` plugin crystallization run `run-20260526-obsidian-lattice-01`.

---

## DEC-001 — Full crystallization authorized over a healthy, shipping plugin
- **status:** locked
- **date:** 2026-05-26
- **context:** P-001 discovery established the plugin is healthy today (baseline `tsc -noEmit -skipLibCheck` = 0 errors, 101 test files, 575 KB shipping bundle). The contract's full execution (all strict flags → 0 errors, eliminate all `as any`, branded IDs, exhaustiveness sentinels, dev-vault runtime gates) is a multi-session, high-blast-radius refactor.
- **decision:** Operator explicitly chose "Full crystallization" when presented the scope/risk trade-off. Proceed through P-002..P-005 literally.
- **consequence:** Every wave must keep baseline green and the test suite passing (R-019). Nothing commits without G-001..G-007 (GR-002).

## DEC-002 — Repair fleet = Claude `Agent` subagents, NOT the lmswarm/local-LLM router
- **status:** locked
- **date:** 2026-05-26
- **context:** Global multitask-routing rule prefers routing LLM-heavy work through `lmstudio-swarm` / `orc-py`. The crystallization repair work is TypeScript refactoring on a 55k-line working Obsidian plugin where a single bad edit can introduce a runtime regression the test suite won't catch.
- **decision:** Repair subagents are dispatched via the `Agent` tool (contract R-017/R-018 semantics: each receives defect record + files + axiom IDs + verify command; emits repair lines; HALTs on ambiguity). Local small models are not used for repair.
- **rationale:** Contract A-003 names "local agent with shell, file-edit, parallel-spawn" = the orchestrating Claude + its Agent tool. Regression-cost on a shipping plugin exceeds the token savings of local routing. The multitask-routing rule targets *3+ independent sub-projects with a dep table*; this is sequential phases of one refactor.

## DEC-003 — Strict flags rolled out by sequential flip-fix-verify, final state = all-on
- **status:** locked
- **date:** 2026-05-26
- **context:** Flipping all R-003 flags at once yields 629 interacting errors; per-flag marginal counts are noFallthroughCasesInSwitch=0, strict-group=1, strictPropertyInitialization=1, noImplicitThis=1, noImplicitOverride=131, exactOptionalPropertyTypes=121, noUncheckedIndexedAccess=374.
- **decision:** Enable flags in waves (cheapest first), drive each to zero, verify (tsc+tests+build), then enable the next. Terminal `tsconfig.json` carries every R-003 flag. Wave order: W0 free-tier (fallthrough+strict-group+propInit+implicitThis) → W1 noImplicitOverride → W2 exactOptionalPropertyTypes → W3 noUncheckedIndexedAccess.
- **consequence:** Satisfies R-003 end-state while keeping every intermediate commit green and regressions attributable to the in-flight wave.

## DEC-004 — Branded types live in `src/types/`, one constructor + one guard per brand
- **status:** locked
- **date:** 2026-05-26
- **context:** R-006 mandates branded types for file paths, view-type IDs, command IDs, setting keys, plugin IDs, leaf IDs. None exist today; `src/types/` is absent.
- **decision:** Create `src/types/brands.ts` as the single canonical home. Each brand gets exactly one `asX(s: string): X` constructor and one `isX(s): s is X` guard. Existing `string`-typed call sites migrate incrementally; this is P-002/P-003 work tracked in REPAIR_QUEUE.

## DEC-005 — R-004 internal-API casts resolved via central module augmentation
- **status:** locked
- **date:** 2026-05-26
- **context:** The dominant `as any`/`as unknown as` cast class is access to undocumented-but-real Obsidian internal APIs (`app.commands`, `app.setting`, desktop adapter `getBasePath`/`basePath`). Deleting them is wrong (the APIs exist); scattering narrow casts is duplication.
- **decision:** Created `src/types/obsidian-augment.ts` — an ambient `declare module "obsidian"` augmentation giving these internal APIs canonical narrow types. Call sites drop the cast and use the API type-checked. Genuinely-needed remaining casts (rare) keep a one-line rationale comment per R-004.

## DEC-006 — R-006 brands are foundation + incremental adoption (assignable-to-base)
- **status:** locked
- **date:** 2026-05-26
- **context:** Branding every ID call site across 405 files in one shot is high-churn/high-risk. Branded types (`string & Brand<X>`) are assignable TO `string`, so a branded value flows into every existing string consumer unchanged.
- **decision:** `src/types/brands.ts` defines the full brand set + one constructor + one guard each (DEC-004 home). Adoption is applied at canonical ID DEFINITION points (view-type constants, etc.) and proceeds incrementally elsewhere without blocking — un-migrated `string` consumers keep compiling. This satisfies R-006's "constructor + guard per brand" and brands the ID categories at their source of truth.

## DEC-007 — Final concerns run as file-ownership fleet, not concern-ownership
- **status:** locked
- **date:** 2026-05-26
- **context:** R-004/R-005/AX-003/AX-004 overlap on hot files (main.ts, views, services). One-agent-per-concern would put multiple agents on the same file → conflict.
- **decision:** One agent per file-group; each agent resolves EVERY applicable concern within its owned files. Union of all affected files (94) partitioned into 8 conflict-free domain groups (no file split). Foundations (brands.ts, obsidian-augment.ts) are single-owner and imported read-only. Integration gate after: full strict tsc + full suite + production build.
