# Contributing to Sauce CRM

Thanks for considering a contribution. Sauce CRM is an Obsidian plugin and a
relationship-graph contract; both the code and the docs are open source under
the MIT license. This guide covers how to get set up, how branches and releases
work, and the bar a change has to clear before it merges.

By participating you agree to abide by our
[Code of Conduct](CODE_OF_CONDUCT.md).

## Quick start

```sh
cd plugin/
npm install
npm run dev          # esbuild watch mode
npm run typecheck    # tsc --noEmit
npm test             # vitest
npm run lint         # eslint
npm run build        # production bundle → main.js
```

To test a dev build inside a real vault, symlink the repo into the vault's
plugin directory:

```sh
ln -s "$(pwd)" "<vault>/.obsidian/plugins/sauce-crm"
```

Reload Obsidian (`Cmd/Ctrl+R`) after each rebuild.

## How the work is organized

Active integration work is tracked under contract **CON-OBS-INTEG-001**. The
plan is decomposed into shards, one Markdown file per shard, under
[`plan/obs-integ/`](plan/obs-integ/):

| File | Shard |
|------|-------|
| [`plan/obs-integ/00-validate.md`](plan/obs-integ/00-validate.md) | Validation & assumptions |
| [`plan/obs-integ/01-foundation.md`](plan/obs-integ/01-foundation.md) | Foundation |
| [`plan/obs-integ/02-community-adapters.md`](plan/obs-integ/02-community-adapters.md) | Community adapters |
| [`plan/obs-integ/03-core-wrappers.md`](plan/obs-integ/03-core-wrappers.md) | Core wrappers |
| [`plan/obs-integ/04-canon.md`](plan/obs-integ/04-canon.md) | Canon |
| [`plan/obs-integ/05-graph.md`](plan/obs-integ/05-graph.md) | Graph |
| [`plan/obs-integ/06-tasks-codegen.md`](plan/obs-integ/06-tasks-codegen.md) | Tasks codegen |
| [`plan/obs-integ/07-downstream.md`](plan/obs-integ/07-downstream.md) | Downstream |
| [`plan/obs-integ/08-oss-community.md`](plan/obs-integ/08-oss-community.md) | OSS community infra |
| [`plan/obs-integ/09-marketplace.md`](plan/obs-integ/09-marketplace.md) | Marketplace |
| [`plan/obs-integ/10-verify.md`](plan/obs-integ/10-verify.md) | Verification |

Each shard file holds a task table (`T-<shard>-NN`) with an output column, an
acceptance column, and a status column. When you pick up a task, work only the
files in that task's `Out` column, and flip its `Status` to `DONE` with a
one-line note when it lands.

## Branching & releases

Branch protection, the release flow, and the BRAT beta channel are documented
in [`docs/branching.md`](docs/branching.md). The short version:

- Branch off `dev` (the BRAT beta source) for new work.
- Name branches `feat/<scope>` or `fix/<scope>`.
- Open a PR into `dev`; promotion to `main` happens via a `release/x.y.z`
  branch.
- `main` is protected: signed tags only, force-push disabled, PR + green CI +
  one approval required to merge.

## Bar for a change to merge

A PR is mergeable when **all** of the following are true. The
[pull request template](.github/PULL_REQUEST_TEMPLATE.md) restates this as a
checklist.

- Branched from `dev`.
- `npm run typecheck` is clean.
- `npm run lint` is reviewed (no new violations).
- `npm test` is green, and the change adds **at least one vitest assertion**
  covering the happy path (plus an error path for new features).
- `npm run sdk:check` is green where the change touches SDK surface.
- No `console.*` in `src/` — route logging through `plugin.logger` (eslint
  enforces this).
- No new secrets in `data.json` — credentials go through `KeyVault` via
  `IntegrationCredentials`.
- If the change is part of a CON-OBS-INTEG-001 shard, the relevant
  `plan/obs-integ/` file is updated and linked from the PR.

## Reporting issues & requesting integrations

Use the issue forms under
[`.github/ISSUE_TEMPLATE/`](.github/ISSUE_TEMPLATE/):

- **Bug report** — something is broken.
- **Feature request** — a capability you'd like.
- **Integration request** — a new external service (OAuth or API-key) to wire
  into the plugin.

## License

By contributing you agree that your contributions are licensed under the
project's [MIT License](LICENSE).
