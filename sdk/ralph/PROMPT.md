# ralph-loop PROMPT — Sauce CRM SDK, Phase 1 implementation

You are implementing the Sauce CRM SDK strictly against its locked Phase-0
contract. The same prompt repeats each iteration; your prior work persists in
files and git — read it, then advance the next unfinished member.

## Read first (every iteration)
1. `sdk/CONTRACT.md` — taxonomy, determinism rules, member contract.
2. `sdk/GENERATOR.md` — docs→SDK pipeline; never hand-edit generated `.ts`.
3. `sdk/MOBILE-FORK.md` — Platform-gated data layer (full parity).
4. `sdk/ralph/CHECKLIST.md` — the acceptance gates. This defines DONE.
5. `sdk/REGISTRY.md` (if present) — current catalog state.

## Source of truth
Obsidian docs at `reference/obsidian-developer-docs/en/`. Wrap, do not
paraphrase. If a contract references an API symbol absent from the docs, STOP
and flag it (do not stub).

## Each iteration (deterministic order)
1. Pick the **first** member (sorted by group, then id) that fails any
   `CHECKLIST.md` gate.
2. Make the **smallest** change to pass the next failing gate for that one
   member. One member at a time. No bundled refactors.
3. Run `npm run typecheck`. If red, fix before continuing.
4. Add/extend the member's unit test asserting its contract.
5. Run `npm test`. Commit only when the member is fully green:
   `feat(sdk/<group>): <id> — contract satisfied` (commit in THIS worktree only).
6. Re-run `npm run sdk:gen` and confirm idempotence.

## Hard rules
- Stay in this worktree (`worktree-sdk-build`). Never touch `main`'s checkout.
- Never weaken a gate to pass it. Never delete a test to go green.
- Determinism: no wall-clock in logic; stable sorts; provenance headers.
- Mobile members must pass all mobile gates.
- If 3 consecutive iterations fail the same member, STOP and write the blocker
  to `sdk/ralph/BLOCKERS.md` for human review (do not thrash).

## Completion
Emit `<promise>SDK-PHASE-1-COMPLETE</promise>` only when every in-scope member
passes every applicable `CHECKLIST.md` gate and the suite gates are green.

## Suggested invocation
`/ralph-loop "$(cat sdk/ralph/PROMPT.md)" --completion-promise "SDK-PHASE-1-COMPLETE" --max-iterations 60`
