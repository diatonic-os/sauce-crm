# CON-OBS-INTEG-001 — Blockers & Findings

> Not a STOP-102 halt — work continues on all unblocked shards (STOP-103 spirit).
> This records the open blockers/findings the operator must resolve.

## BLOCKER-LINT — ✅ RESOLVED (2026-05-23, operator-approved housekeeping)

**Resolution:** one-shot `prettier --write 'src/**/*.ts'` + `eslint --fix` on `dev`
(commit `06ce82a`, 294 files) as a SEPARATE housekeeping commit outside any T-* task,
plus 3 residual fixes (2 unnecessary-escape in CdelLexer.ts; 1 eslint-disable for an
intentional console placeholder in SkillRuntime.ts). `dev` merged into the contract
branch. **`npm run lint` now exits 0** (6 unused-var warnings remain — warnings don't
fail the gate). Full 4-gate green on `feat/con-obs-integ-001-foundation`: lint +
typecheck + 438 tests + sdk:check. STOP-101's lint criterion is now satisfiable.

### Original finding (for the record)

**Discovered:** Phase 2 (after SH-B), when first running the bare `npm run lint` gate.

**Symptom:** `npm run lint` (= `eslint src/**/*.ts`) reports **6530 problems**: 6527
`prettier/prettier`, 6 `@typescript-eslint/no-unused-vars`, plus a few misc — spread
across **143 of 321 pre-existing `src/` files**.

**Root cause:** pre-existing. Almost certainly the prettier/eslint config or version
change carried in the **dirty `package.json` / `package-lock.json` / `vitest.config.ts`**
that were already modified in the working tree at session start (see initial `git status`).
The whole committed tree now reads as "unformatted" under the new rules.

**Not caused by this contract:** every CON-OBS-INTEG-001 file (13 so far) passes
`eslint --fix` individually with **zero** errors. None appear in the error set
(verified by grepping the full lint output against all new file names).

**Impact on the per-task gate:** the contract's step-5 `npm run lint` green is
**unsatisfiable** without reformatting 143 files outside every task's declared `out`
set — which would violate "no commit touches files outside its task's declared out set"
and "no scope creep."

**Interpretation applied (pending operator decision):** per-task verification =
*each new file* lint-clean (`eslint --fix`) **+** `npm run typecheck` 0 **+**
`npm run test` green **+** `npm run sdk:check` green. All shipped tasks meet this.

**Operator decision needed:** run a one-shot tree-wide `npm run lint -- --fix`
(or `npx prettier --write 'src/**/*.ts'`) as a **separate** housekeeping commit
outside this contract? It would touch 143 files and auto-fix 6527 of the errors.
Recommend doing it on `dev` before merging the contract branch, NOT inside a T-* commit.

---

## BLOCKER-2 — ✅ RESOLVED (operator enabled the Obsidian CLI, 2026-05-23)

`obsidian eval` now works. Ran the mandated enumeration: **A-005 PASS** (community +
core plugins enumerable), **A-006 PASS** (tasks `apiV1` = exactly the 3 documented
methods). Empirical JSON recorded in `plan/obs-integ/00-validate.md`. **SH-F is
unblocked** (introspector can run `obsidian eval` against the live vault).

---

## BLOCKER-3 — External PR authorization (SH-I) — resolved to "defer"

Operator decision: push branches OK, **no external PR**. SH-I (T-I-01/T-I-02) authors
`community-plugins-entry.json` + `PR-BODY.md` locally; the actual PR to
`iamdrewfortini/obsidian-releases` is opened manually by the operator. Not a halt.
