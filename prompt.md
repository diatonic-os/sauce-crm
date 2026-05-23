# CON-UI-CANON-001 Execution Prompt

You are executing the Plugin UI Canonization & Settings Control Plane contract.

## Source Of Truth

- `plan/00-audit.md`
- `plan/01-tokens.md`
- `plan/02-primitives.md`
- `plan/03-react-adapter.md`
- `plan/04-svelte-adapter.md`
- `plan/05-settings-core.md`
- `plan/06-settings-md.md`
- `plan/07-icons.md`
- `plan/08-migration.md`
- `plan/09-verify.md`
- `settings/home.md`

## Execution Mode

Run in phase-gated fanout:

1. Complete SH-A first: tokens and primitives.
2. In parallel, complete SH-B, SH-C, SH-D, SH-E, and SH-H.
3. In parallel, complete SH-F and SH-G.
4. Complete SH-V.

## Non-Negotiables

- No product features.
- No backend schema changes.
- No business logic rewrites outside UI/settings.
- No inline styles.
- No settings controls without registry keys, defaults, validators, handlers, and persistence.
- No React-only or Svelte-only component.
- Unknown surface becomes a plan entry.
- Do not include secrets, tokens, or PII in plan, prompts, or commits.

## First Worker Task

Start with `plan/01-tokens.md` and `plan/02-primitives.md`.

Before editing code:

1. Read `plan/00-audit.md`.
2. Confirm the worktree dirty state and avoid unrelated files.
3. Create only the files required by the active shard.
4. Run the relevant verification command.
5. Update the corresponding plan file with DONE/BLOCKED state.

## Stop Signals

- STOP-001: all acceptance criteria pass; emit `deliverables/CON-UI-CANON-001/FINAL.md`.
- STOP-002: plan unchanged and zero tasks completed for three consecutive iterations; emit `BLOCKERS.md`.
- STOP-003: guardrail violation detected and not auto-fixable; block affected shard and continue safe shards.
