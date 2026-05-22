# Marketplace submission runbook

Pre-flight checklist — every box MUST be checked before running the gh
commands at the bottom. The Obsidian releases repo runs an automated
linter against the PR; missing any of these fails the lint.

## Prerequisites

- [ ] GitHub repo at `https://github.com/dacvisuals/sauce-graph` is **public**.
- [ ] Repo has a `LICENSE` file at the root. (Plugin ships MIT — already at `plugin/LICENSE`.)
- [ ] Repo has a `README.md` at the root with usage instructions.
- [ ] Latest release tag matches `manifest.json` version exactly (no `v` prefix).
- [ ] Release has three assets attached, **not** zipped:
  - `main.js`
  - `manifest.json`
  - `styles.css`
- [ ] `manifest.json` `id` is `sauce-crm` (matches community-plugins-entry.json).
- [ ] `manifest.json` does NOT contain `fundingUrl: ""` (Obsidian linter rejects empty strings).
- [ ] No use of `@ts-ignore` without a reason comment in shipped TS.
- [ ] No use of `eval`, `Function` constructor, or `innerHTML` with user input.
- [ ] `npm run lint` is green (or warnings reviewed and acceptable).
- [ ] CI workflow at `.github/workflows/ci.yml` is green on `main`.

## Release flow (run from `plugin/`)

```bash
# 1. Bump version
npm version patch   # or minor/major
git push --follow-tags

# 2. The release.yml workflow auto-creates the GitHub Release with main.js,
#    manifest.json, styles.css attached. Verify at:
#    https://github.com/dacvisuals/sauce-graph/releases/latest

# 3. Confirm the release assets:
gh release view "$(node -p 'require(\"./manifest.json\").version')" \
   --repo dacvisuals/sauce-graph \
   --json assets | jq -r '.assets[].name' | sort
# Expected (3 lines):
#   main.js
#   manifest.json
#   styles.css
```

## File the marketplace PR

After the release is live with the three assets:

```bash
# Fork obsidianmd/obsidian-releases first via the GitHub UI (one-time).
# Then on your local machine:
gh repo fork obsidianmd/obsidian-releases --clone=true
cd obsidian-releases
git checkout -b add-sauce-crm

# Append the entry to community-plugins.json (last entry, before the
# closing `]`). Use jq to keep the file valid.
ENTRY="$(cat /home/daclab-ai/Desktop/sauce-graph/.github/marketplace/community-plugins-entry.json)"
jq --argjson new "$ENTRY" '. += [$new]' community-plugins.json \
  > community-plugins.json.tmp && mv community-plugins.json.tmp community-plugins.json

git add community-plugins.json
git commit -m "Add Sauce CRM"
git push --set-upstream origin add-sauce-crm

# Open the PR with the prepared body
gh pr create \
  --repo obsidianmd/obsidian-releases \
  --base master \
  --title "Add Sauce CRM" \
  --body-file /home/daclab-ai/Desktop/sauce-graph/.github/marketplace/PR-BODY.md
```

## Post-submission

- Watch the PR's linter run (it's automated; usually finishes in <2 minutes).
- Common failures:
  - `Error: Couldn't find the latest release for this plugin` — release tag
    doesn't match `manifest.json` version, or assets missing.
  - `Error: Plugin id matches an existing plugin` — `sauce-crm` is taken;
    pick a new id (and update `manifest.json` + the entry JSON before
    re-pushing).
  - `Error: Author URL must not be the plugin repo URL` — change
    `authorUrl` in manifest.json to your personal site or GitHub profile.

Once the PR is merged, the plugin appears in Obsidian's Community Plugins
browser within a few minutes (search "Sauce CRM").
