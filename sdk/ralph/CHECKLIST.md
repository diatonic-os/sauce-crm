# SDK Acceptance Checklist (ralph completion gate)

> Machine-checkable gates. A member is DONE only when every applicable box is
> green. Derived from `CONTRACT.md §5`, `MOBILE-FORK.md`, and Obsidian's
> self-critique checklists. ralph-loop must not emit its completion promise
> until ALL in-scope members pass.

## Per-member gates (all members)
- [ ] Contract `.md` frontmatter valid per `CONTRACT.md §2` (all required keys, typed inputs/outputs).
- [ ] `id` is unique across the registry and unchanged from any prior version.
- [ ] Implementation `.ts` exists and satisfies the declared inputs/outputs.
- [ ] Provenance header present (`source` + `api_version` + `gen_hash`) on generated files.
- [ ] `npm run typecheck` clean (no `error TS`).
- [ ] Unit test exists that asserts the contract (table-driven where pure).
- [ ] `depends_on` edges resolve and the global DAG is acyclic.
- [ ] `side_effects` declared accurately; pure groups (`helpers`) have none.
- [ ] Determinism: no wall-clock in logic; stable iteration order.

## Mobile gates (members with platform including `mobile`)
- [ ] No top-level Node import; native `require()` gated behind `Platform.isDesktopApp`.
- [ ] No `FileSystemAdapter` cast without `instanceof` check (use `CapacitorAdapter` path).
- [ ] No regex lookbehind.
- [ ] Smoke test passes under a `Platform.isMobileApp = true` stub.

## UI gates (components/)
- [ ] Styles use CSS-variable tokens from `sdk/generated/css-tokens.ts` only — zero literals.
- [ ] Renders under both theme modes via Obsidian theme vars.

## Suite gates (whole SDK, before promise)
- [ ] `npm run sdk:gen` is idempotent (re-run produces no diff).
- [ ] `npm run typecheck` + `npm test` + `npm run build` all green.
- [ ] `sdk/REGISTRY.md` regenerated and matches the eight `_index.md`.
- [ ] No member in scope is missing an implementation or test.

## Completion promise
When — and only when — every in-scope box above is green, emit:
`<promise>SDK-PHASE-1-COMPLETE</promise>`
