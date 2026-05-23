<!-- Thanks for contributing to Sauce CRM! -->

## What & why

<!-- Summary of the change and the motivation. Link the issue if any. -->

Closes #

## Contract checklist

Contributions follow the CON-OBS-INTEG-001 per-task contract (see
[`plan/obs-integ/`](../plan/obs-integ/) and [`CONTRIBUTING.md`](../CONTRIBUTING.md)):

- [ ] Branched from `dev` (`feat/*` or `fix/*`) — see [`docs/branching.md`](../docs/branching.md)
- [ ] Scope limited to the files this change declares (no unrelated edits)
- [ ] ≥1 test exercises the change (R-002)
- [ ] `npm run lint` green
- [ ] `npm run typecheck` green
- [ ] `npm test` green
- [ ] `npm run sdk:check` green (generated SDK up to date)
- [ ] Public `svcV1` symbols (if added) documented in [`docs/services-api.md`](../docs/services-api.md) (R-004)

## Guardrails

- [ ] No inline styles — tokenized CSS only (G-001)
- [ ] No raw Obsidian API handle leaked through `svcV1` (G-010)
- [ ] No writes to canonized files outside `mutateViaContract` (G-003)
- [ ] No secrets / tokens / PII in any tracked file (G-009)

## Notes

<!-- Anything reviewers should know: DEC amendments, follow-ups, screenshots. -->
