# SH-H — OSS Community Infra

**Deps:** none (t=0, parallel to SH-A) · **Owner:** orchestrator · **Status:** `DONE` (on branch `feat/con-obs-integ-001-sh-h`; salvage `655b50c` + completion `c13b77e`)
**Goal:** FUNDING, SPONSORS, branching docs, BRAT beta workflow, issue/PR templates, README sponsor block. Docs/CI only — no production code, no CLI dep.

| Task | Out | Acc | Status |
|------|-----|-----|--------|
| T-H-01 | `.github/FUNDING.yml` | github=iamdrewfortini + buy-me-a-coffee + patreon, logancyang shape (DEC-009) | **DONE** |
| T-H-02 | `SPONSORS.md` | SP-supporter $5 / SP-sponsor $25 / SP-contributor $100 / SP-maintainer $500 + perks | **DONE** |
| T-H-03 | `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md` | contributor guide refs CON-OBS-INTEG-001; Contributor Covenant 2.1 | **DONE** (CoC by reference, not verbatim) |
| T-H-04 | `docs/branching.md` | documents DEC-008; matches repo enforcement (G-007) | **DONE** |
| T-H-05 | `.github/workflows/release-beta.yml` | tag vX.Y.Z-beta.N → prerelease + main.js/styles.css/manifest.json assets for BRAT | **DONE** |
| T-H-06 | `.github/ISSUE_TEMPLATE/{bug,feature,integration-request}.yml`, `.github/PULL_REQUEST_TEMPLATE.md` | 3 issue templates + PR template referencing plan/obs-integ/ | **DONE** |
| T-H-07 | `README.md` | sponsor section + tier callouts + BRAT install line (G-008: no in-plugin donation prompt) | **DONE** (BRAT line pre-existed; added 4-tier Sponsors section) |

**Notes:** Lives on its own branch (parallel to SH-A per the contract). T-H-01/02/03(CONTRIBUTING) were salvaged from the crashed background agent at `655b50c`; the remaining 8 files were authored directly (no subagent — the CoC verbatim text crashed the agent on a content filter, so the CoC references Contributor Covenant 2.1 by link). release-beta.yml uses an env-var tag (no untrusted-input interpolation). **Integration:** the sh-h branch predates the dev reformat merge; a clean merge into the foundation branch takes foundation's reformatted `src/` (sh-h never touched src/) + adds the SH-H docs. Operator merges per finishing-a-development-branch (push OK, no external PR).
