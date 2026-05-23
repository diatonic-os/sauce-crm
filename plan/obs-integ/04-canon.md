# SH-D — Canonization Engine

**Deps:** SH-A · **Owner:** TBD · **Status:** `TODO`
**Goal:** read-only enforcement of canonized .md + contract mutation channel + generated entity view.

| Task | Out | Acc | Status |
|------|-----|-----|--------|
| T-D-01 | `src/services/CanonService.ts` | reads `sauce.canonized=true`; lock/unlock/isCanonized/mutateViaContract/getCanonizedPaths/registerCanonRule | TODO |
| T-D-02 | `src/ui/editor/CanonReadOnlyExtension.ts` | CodeMirror StateField + EditorView.editable.of(false) on canonized files; suppress paste/drop; toast on edit (G-005) | TODO |
| T-D-03 | `src/ui/views/CanonViewRenderer.ts` | renders entity HTML from frontmatter + structured body markers; no user-text parsing | TODO |
| T-D-04 | `src/services/MutationContract.ts` | all writes append ENT-ledger entry (prevHash chain, R-007); pre-write redactor (G-004) + post-write Event emission | TODO |

**Notes:** DEC-002 marker = `sauce.canonized: true` + `sauce.type: <ENT-id>`. G-003: no adapter calls Vault.modify on canonized files — all via mutateViaContract. CodeMirror packages are esbuild externals (esbuild.config.mjs).
