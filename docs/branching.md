# Branching & Release Model

> CON-OBS-INTEG-001 · SH-H (T-H-04) · documents DEC-008 + G-007.

## Branches

```
main ◄── release/x.y.z ◄── feat/*  |  fix/*
                                     dev  (BRAT beta source)
```

| Branch | Purpose | Protection |
|--------|---------|------------|
| `main` | Production. Each merge corresponds to a released version. | Protected: PR + green CI + 1 approval + **signed tag**; force-push disabled. |
| `release/x.y.z` | Release stabilization for a version. Cut from `dev`/`main`, merged to `main`. | Deleted on merge. |
| `dev` | Integration + **BRAT beta source**. Pre-release builds are cut from here. | PR + green CI. |
| `feat/*`, `fix/*` | Day-to-day work. Branch from `dev`, PR back into `dev`. | PR + green CI. |

## Release tags (DEC-008)

| Tag pattern | Fires | Result |
|-------------|-------|--------|
| `vX.Y.Z` (e.g. `v0.3.0`) | `release.yml` | Stable GitHub Release with `main.js` / `manifest.json` / `styles.css`. |
| `vX.Y.Z-beta.N` (e.g. `v0.3.0-beta.1`) | `release-beta.yml` | **Prerelease** with the same assets, consumable by [BRAT](https://github.com/TfTHacker/obsidian42-brat). |

> Note: the stable workflow currently matches bare `X.Y.Z` tags; the beta
> workflow matches `vX.Y.Z-beta.N`. Beta consumers add `Diatonic-OS/sauce-crm`
> to BRAT and opt into the beta channel (see `SPONSORS.md` — beta access is a
> sponsor perk, gated behind the `saucecrm.beta.enabled` setting, default off).

## Branch protection (G-007)

`main` requires:

1. A pull request (no direct pushes).
2. Green CI (`lint`, `typecheck`, `test`, `sdk:check`, `build`).
3. At least **1 approving review**.
4. A **signed tag** for the release commit.
5. Force-push **disabled**; `release/*` branches **deleted on merge**.

## Per-contributor flow

1. `git switch dev && git pull`
2. `git switch -c feat/my-thing`
3. Implement with tests; run `npm run lint && npm run typecheck && npm test && npm run sdk:check`.
4. Open a PR into `dev`. CI must be green and the PR reviewed.
5. Maintainer cuts `release/x.y.z` from `dev`, bumps `manifest.json`, tags `vX.Y.Z` (signed), merges to `main`.
