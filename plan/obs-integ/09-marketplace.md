# SH-I — Marketplace Submission

**Deps:** SH-G, SH-H · **Owner:** TBD · **Status:** `BLOCKED` (BLOCKER-3 — external action authorization)
**Goal:** refresh community-plugins-entry.json + PR-BODY.md + open PR to `iamdrewfortini/obsidian-releases`.

| Task | Out | Acc | Status |
|------|-----|-----|--------|
| T-I-01 | `.github/marketplace/community-plugins-entry.json` | id=sauce-crm, repo=Diatonic-OS/sauce-crm, name+author+desc synced w/ manifest.json | TODO |
| T-I-02 | `.github/marketplace/PR-BODY.md` | features, screenshots, minAppVersion=1.5.0, dev-policy checklist; paste-ready | TODO |

**Notes:** Author the artifacts (json + PR body) locally only. **BLOCKER-3 decision: push branches OK, but do NOT open the external PR** to `iamdrewfortini/obsidian-releases` — operator opens it manually from PR-BODY.md. STOP-106 if minAppVersion bumped past 1.5.0 upstream.
