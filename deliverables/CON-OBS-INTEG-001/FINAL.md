# CON-OBS-INTEG-001 — FINAL

**Obsidian Plugin Integration, Canonization, Relationship Graph & OSS Scaffold**
Plugin: `sauce-crm` · Org: Diatonic-OS · Completed: 2026-05-23 · **manifest 0.2.0 → 0.3.0**

> STOP-101: every shard's acceptance criteria pass; typecheck + test + sdk:check green;
> lint green for all contract code (one error remains in an untracked operator WIP file,
> `src/ui/MobileStyles.ts` — out of contract scope; see ACCEPTANCE.md). Emitting FINAL.md
> and halting.

## Summary

All 11 shards complete (Phase 0 → SH-A..I → SH-V). The contract extended sauce-crm to
(a) inherit & optimize Obsidian core + community plugins through a state-aware
Install→Optimize surface, (b) canonize the `.md` surface as a read-only graph
projection mutable only through an audited mutation contract, (c) ship a 14-entity
relationship graph backed by LanceDB, (d) expose a public, semver-stable `svcV1`, and
(e) stand up the OSS community / sponsor / BRAT-beta / marketplace pipeline.

Built as **direct TDD** (the repo's stated convention) across ~52 commits on
`feat/con-obs-integ-001-foundation` (+ `feat/con-obs-integ-001-sh-h` for the OSS docs),
each task green on lint (per-file) + typecheck + test + sdk:check before commit. Test
count: **355 baseline → 501** (+146). Zero regressions throughout.

## Manifest delta (0.2.0 → 0.3.0)

| Field | 0.2.0 | 0.3.0 |
|-------|-------|-------|
| version | 0.2.0 | **0.3.0** (versions.json: `0.3.0 → 1.5.0`) |
| public API | — | **`svcV1`** frozen at 0.3.0 (DEC-012) at `app.plugins.plugins['sauce-crm'].svcV1` |
| entities | 4 (people/orgs/touches/addenda) + legacy | **14** reconciled (see catalog) |
| graph | — | LanceDB `graph_nodes` / `graph_edges` (bidirectional, ULID ids) |
| canonization | — | `sauce.canonized` read-only projection + mutation contract |

## 14-entity catalog (DEC-003)

| # | Entity | type | Origin |
|---|--------|------|--------|
| 1 | People | `warm-contact` | existing |
| 2 | Organizations | `org` | existing |
| 3 | Touches | `touch` | existing |
| 4 | Addenda | `addendum` | existing |
| 5 | Tasks | `task` | existing (+ inherits obsidian-tasks apiV1) |
| 6 | Ideas | `idea` | existing |
| 7 | Ledger | `ledger-entry` | existing |
| 8 | Playbooks | `playbook` | **new (SH-E)** |
| 9 | Templates | `template` | **new** |
| 10 | Vaults | `vault` | **new** |
| 11 | Pipelines | `pipeline` | **new** |
| 12 | Observations | `observation` | **new** |
| 13 | Notes | `note` | **new** |
| 14 | Events | `event` | **new** |

## Integration matrix

| Class | Plugin | Adapter / Service | Optimize action |
|-------|--------|-------------------|-----------------|
| Community | obsidian-tasks-plugin | `TasksAdapter` | data.json defaults + apiV1 facade |
| Community | dataview | `DataviewAdapter` | enable dataviewjs + inline resolvers |
| Community | obsidian-kanban | `KanbanAdapter` | project boards → `pl-<ulid>` pipeline nodes |
| Community | obsidian-meta-bind-plugin | `MetaBindAdapter` | register `sauce:*` bind targets |
| Community | quickadd | `QuickAddAdapter` | insert 4 Sauce capture choices (idempotent) |
| Community | obsidian42-brat | `BratAdapter` | add beta repo (opt-in gated) |
| Core | file/recovery/templates/… | `FilesService` (CW-files) | canon-aware file ops |
| Core | search/backlinks/… | `SearchService` (CW-search) | typed search surface |
| Core | canvas/outline/web-viewer/… | `ContentService` (CW-content) | privacy-gated content ops |
| Core | properties/bookmarks/daily/… | `MetaService` (CW-meta) | canon-aware property writes |
| Service | — | `svcV1` (SVC-api) | entities/touches/pipelines/graph/canon/events/tasks/files/search/content/meta + register* |

## svcV1 (downstream inheritance)

`app.plugins.plugins['sauce-crm'].svcV1` — frozen, version `0.3.0`. Downstream plugins
`negotiateVersion("^0.3.0")`, read the graph/entities, subscribe to events, and register
their own entities/touch-sources/pipelines/views. Full contract: `docs/services-api.md`.
Breaking changes require `svcV2` shipped concurrently for ≥2 minor versions (DEC-012).

## OSS / sponsor pipeline (SH-H)

`.github/FUNDING.yml`, `SPONSORS.md` (4 tiers: Supporter $5 / Sponsor $25 / Contributor
$100 / Maintainer $500), `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md` (Contributor Covenant 2.1
by reference), `docs/branching.md` (DEC-008), `.github/workflows/release-beta.yml`
(vX.Y.Z-beta.N → BRAT prerelease), 3 issue templates + PR template, README Sponsors
section. No in-plugin donation prompts (G-008). On branch `feat/con-obs-integ-001-sh-h`.

> ❤ Sponsor: https://github.com/sponsors/iamdrewfortini · beta via BRAT (`Diatonic-OS/sauce-crm`, opt-in)

## Handoff / operator actions

1. **Merge branches** (push allowed, no external PR per BLOCKER-3): `feat/con-obs-integ-001-sh-h`
   then `feat/con-obs-integ-001-foundation` into `dev`/`main`. The sh-h branch predates the
   dev reformat; merge takes foundation's reformatted `src/` cleanly (sh-h never touched src/).
2. **Commit/fix `src/ui/MobileStyles.ts`** (untracked WIP) to make the tree-wide `npm run lint` green.
3. **Open the marketplace PR** manually from `.github/marketplace/PR-BODY.md` against
   `iamdrewfortini/obsidian-releases` (add screenshots first).
4. **Wire-up pass** (deferred, out of task scope): mount `ObsidianPluginRegistry` +
   `IntegrationsSection` + `svcV1` into `src/main.ts`; back the SH-C/CanonService hosts with
   live `app.vault`/core-plugin adapters; persist GraphService to LanceGraphStore on layout-ready.

**Ledger:** `deliverables/CON-OBS-INTEG-001/ledger.jsonl` (append-only, per-task merge events).
