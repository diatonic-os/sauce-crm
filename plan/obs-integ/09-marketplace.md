# SH-I — Marketplace Submission

**Deps:** SH-G, SH-H · **Owner:** orchestrator · **Status:** `DONE` (artifacts authored; external PR deferred per BLOCKER-3)
**Goal:** refresh community-plugins-entry.json + PR-BODY.md + open PR to `iamdrewfortini/obsidian-releases`.

| Task | Out | Acc | Status |
|------|-----|-----|--------|
| T-I-01 | `.github/marketplace/community-plugins-entry.json` | id=sauce-crm, repo=Diatonic-OS/sauce-crm, name+author+desc synced w/ manifest.json | **DONE** (already in sync; verified id/name/author/repo/description match manifest.json) |
| T-I-02 | `.github/marketplace/PR-BODY.md` | features, screenshots, minAppVersion=1.5.0, dev-policy checklist; paste-ready | **DONE** (rewritten: fixed stale repo URL → Diatonic-OS/sauce-crm; 0.3.0 feature set; checklist; ≤200 lines) |

**Notes:** **BLOCKER-3 honored — artifacts authored locally only; the external PR to `iamdrewfortini/obsidian-releases` is NOT opened. Operator opens it manually from PR-BODY.md.** minAppVersion stays 1.5.0 (no STOP-106 trigger). community-plugins-entry.json needs no version field, so it stays synced across the 0.2.0→0.3.0 manifest bump (SH-V).
