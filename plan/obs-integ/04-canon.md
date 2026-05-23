# SH-D — Canonization Engine

**Deps:** SH-A · **Owner:** orchestrator · **Status:** `DONE` (4 tasks; 475 tests green)
**Goal:** read-only enforcement of canonized .md + contract mutation channel + generated entity view.

| Task | Out | Acc | Status |
|------|-----|-----|--------|
| T-D-01 | `src/services/CanonService.ts` | reads `sauce.canonized=true`; lock/unlock/isCanonized/mutateViaContract/getCanonizedPaths/registerCanonRule | **DONE** (satisfies CanonGuard seam) |
| T-D-02 | `src/ui/editor/CanonReadOnlyExtension.ts` | CodeMirror StateField + EditorView.editable.of(false) on canonized files; suppress paste/drop; toast on edit (G-005) | **DONE** |
| T-D-03 | `src/ui/views/CanonViewRenderer.ts` | renders entity HTML from frontmatter + structured body markers; no user-text parsing | **DONE** |
| T-D-04 | `src/services/MutationContract.ts` | all writes append ENT-ledger entry (prevHash chain, R-007); pre-write redactor (G-004) + post-write Event emission | **DONE** (also exports `ulid()` reused by SH-E) |

**Notes:** DEC-002 marker = `sauce.canonized: true` + `sauce.type`. MutationContract is the engine (R-007 sha256 chain + G-004 redactor + ev-`ulid` Event); CanonService delegates `mutateViaContract` to it and structurally satisfies the `CanonGuard` seam SH-C consumes (compile-time test). CanonReadOnlyExtension extracts pure paste/drop/keydown guard logic for testability (CodeMirror wiring thin; @codemirror/* are esbuild externals). CanonViewRenderer reads frontmatter + structured markers only (G-001 tokenized classes). **Scope note:** G-004's secret-pattern set lives inline in MutationContract.ts to keep T-D-04 in its `out`; flagged to migrate to src/security/ later.
