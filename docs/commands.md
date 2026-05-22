# Command Reference

Every command Sauce Graph registers. Source of truth: `src/main.ts` (V1 surface) and `src/ui/commands/V2Commands.ts` (V2 SPEC §40 catalogue — note: V2 ids are wired directly in `main.ts.registerCommands()`).

Hotkeys use `Mod` = Cmd on macOS, Ctrl on Linux/Windows.

## Entity creation

| Command ID | Display Name | Default Hotkey | Description |
|---|---|---|---|
| `new-person` | New Person | Mod+Shift+P | Open the person modal; creates a `warm-contact` entity. |
| `new-org` | New Org | Mod+Shift+O | Open the org modal; creates an `org` (or `subsidiary` if parent set). |
| `log-touch` | Log Touch | Mod+Shift+T | Log an interaction; creates an immutable `touch` entity. |
| `new-addendum` | New Addendum | Mod+Shift+A | Append an immutable correction/enrichment to the active note. |
| `new-intro` | New Intro | Mod+Shift+I | Create a directional `intro_via` / `referral_to` edge between two contacts. |
| `new-relation` | New Relation | — | Add a typed edge from the active note to another entity. |
| `edit-current` | Edit Current Note | Mod+E | Re-open the modal appropriate to the active note's type. |
| `promote-prospect` | Promote Prospect | — | Convert a `primary_type: prospect` person into a fuller warm-contact (per CLAUDE.md §4.5 cold-promotion rule). |
| `bump-last-touch` | Bump last_touch | — | Set the active entity's `last_touch:` to today. |

## Tags

| Command ID | Display Name | Description |
|---|---|---|
| `tag-rename` | Tag — Rename | Rename a tag across the vault. |
| `tag-merge` | Tag — Merge | Merge two tags. |
| `tag-delete` | Tag — Delete | Delete a tag everywhere. |

## Views (dashboards)

| Command ID | Display Name | Description |
|---|---|---|
| `open-dashboard` | Open Dashboard | Top-level overview (counts, overdue, recent touches). |
| `open-pipeline` | Open Pipeline Kanban | Kanban over `primary_type`. |
| `open-graph` | Open Typed-Edge Graph | Force-layout graph filtered by edge type. |
| `open-compat` | Open Compatibility Matrix | Pairwise admissibility (`ρ_adm`) heatmap. |
| `open-heatmap` | Open Touch Heatmap | Cadence vs. last_touch matrix. |
| `open-hierarchy` | Open Hierarchy Tree | `subtype_of:` / `parent:` tree view. |
| `open-overdue` | Open Overdue Queue | Contacts past their cadence interval. |
| `open-parent-dashboard` | Open Parent Vault Dashboard | Federated rollup over registered SubVaults. |
| `open-copilot` | Open Copilot | Chat surface for the configured LLM provider. |
| `open-map` | Open Map | Geocoded entity map (requires Geocode skill). |
| `open-ai-inbox` | Open AI Inbox | Queue of skill proposals awaiting review. |
| `open-sync-status` | Open Sync Status | Integration sync state. |

## V2 surface (SPEC §40)

| Command ID | Display Name | Default Hotkey | Description |
|---|---|---|---|
| `quick-capture` | Quick Capture (CDEL) | Mod+K | CDEL idiom-based fast capture modal. |
| `import` | Import (CSV/vCard/ICS/JSON) | — | Mapping UI for bulk import. |
| `sauce:open-sync-status` | Open Sync Status | — | (alias surface) |
| `sauce:open-audit-log` | Open Audit Log | — | Walk the HMAC-chained audit log. |
| `sauce:summarize-current` | Summarize Current Note | — | Run the `summarize-thread` skill on the active file. |
| `sauce:research-current` | Research Current Note | — | Run the `research-person` skill on the active file. |
| `sauce:geocode-current` | Geocode Current Note | — | Run the `geocode` skill. |
| `sauce:capture-call` | Capture Call (Twilio) | — | Bind a Twilio call recording to a touch. |
| `sauce:transcribe-file` | Transcribe Audio File… | — | Run the `transcribe` skill. |
| `sauce:lock-vault` | Lock Vault | — | Zero the in-memory master key. |
| `sauce:unlock-vault` | Unlock Vault | — | Prompt for master password and derive key. |
| `sauce:rotate-keys` | Rotate Keys… | — | Re-key the secret store. |
| `sauce:verify-audit-chain` | Verify Audit Chain | — | Walk the HMAC chain end-to-end. |
| `sauce:sync-now` | Sync Now (all eligible) | — | Trigger every enabled integration. |
| `sauce:import` | Import… | — | Same as `import` above. |
| `sauce:export` | Export… | — | Same as `export-graph-json`. |
| `sauce:backup-now` | Backup Now (Encrypted) | — | Write an AES-GCM-sealed backup bundle. |
| `sauce:reseed-backend` | Wipe and Reseed Backend | — | Rebuild SQLite mirror from vault truth. |
| `sauce:run-inference-pass` | Run Inference Pass | — | Propose new edges; results land in AI Inbox. |
| `sauce:propose-merges` | Propose Merges | — | Run `merge-duplicates`. |
| `sauce:weekly-briefing` | Weekly Briefing | — | Run `summarize-week`. |
| `sauce:open-skill-runs` | Open Skill Run Log | — | History of every skill invocation. |
| `sauce:reload-cdel-idioms` | Reload CDEL Idioms | — | Re-read CDEL grammar from settings. |
| `run-skill` | Run Skill… | — | Skill picker modal. |

## Vault / federation

| Command ID | Display Name | Description |
|---|---|---|
| `initialize-vault` | Initialize Vault | Scaffold folders + `_PLUGIN-CONFIG.md`. |
| `initialize-parent-vault` | Initialize Parent Vault | Create `PARENT-VAULT.md` for federation. |
| `register-subvault` | Register SubVault | Add a SubVault to the parent registry. |
| `unregister-subvault` | Unregister SubVault | Remove a SubVault. |
| `validate-federation` | Validate Federation | Run federation gate against all SubVaults. |
| `validate-vault` | Validate Vault | Walk every entity through the contract validator. |
| `reconcile-edges` | Reconcile Edges | Full-vault edge symmetry pass. |
| `export-graph-json` | Export Graph JSON | Dump entities + adjacency to a single JSON file. |
| `rebuild-cache` | Rebuild Caches | Invalidate plugin caches. |
| `run-backup` | Run Backup Now | Write an unencrypted backup bundle to the plugin folder. |
| `prune-backups` | Prune Old Backups | Delete backups older than 14 days. |
| `sync-integrations` | Sync All Integrations | One-shot pull across every configured integration. |

## Query

| Command ID | Display Name | Hotkey | Description |
|---|---|---|---|
| `run-path-query` | Run Path Query | — | Hint to use a `sauce-dql` PATH block. |
| `fuzzy-search` | Sauce Fuzzy Search | Mod+P | Hint to use the dashboard. |

## Markdown code-block processors

Two embedded processors are registered alongside the commands:

- ` ```sauce-button ` — renders an actionable button widget driven by a YAML body.
- ` ```sauce-dql ` — runs the embedded query (graph adjacency, path, filter) and renders the result inline.
