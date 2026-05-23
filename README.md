# Sauce CRM

Relationship CRM for Obsidian. People, Organizations, Touches, Addenda — form-driven, contract-validated, with an encrypted KeyVault for OAuth + API credentials and a Copilot that auto-indexes models from every provider it knows about.

[![CI](https://github.com/Diatonic-OS/sauce-crm/actions/workflows/ci.yml/badge.svg)](https://github.com/Diatonic-OS/sauce-crm/actions/workflows/ci.yml)
[![Security](https://github.com/Diatonic-OS/sauce-crm/actions/workflows/security.yml/badge.svg)](https://github.com/Diatonic-OS/sauce-crm/actions/workflows/security.yml)

## Why Sauce CRM

Most CRMs assume you're an outbound sales team. Sauce CRM treats your vault as the source of truth for *every* relationship in your life — co-founders, advisors, mentors, peers, family, vendors — and gives you a typed model on top of it (`primary_type`, `roles[]`, `closeness 1–5`, `cadence`, `intro_via`, etc.) so you can ask real questions like "who haven't I touched in 6 months and owes me a reply" without resorting to a manual spreadsheet.

## Features

- **Form-only CRUD** — every entity is a typed form (PersonModal, OrgModal, TouchModal, AddendumModal). Markdown frontmatter stays canonical; you never have to remember field names.
- **Contract validator** — `ContractValidator` checks every write against a spec. Strict mode blocks, warn mode flags, log mode just records to TRACE-LOG.
- **Symmetric edges** — when you say A knows B, B automatically knows A. Same for `worked_with`, `intro_via`, `family`. Reciprocity is enforced.
- **Semiring path queries** — `PATH FROM [[A]] TO [[B]] OVER knows MAXIMIZE warmth` returns the strongest closeness chain between two people. Useful for warm-intro discovery.
- **Multi-vault federation** — register sub-vaults; queries can span them; addendum rollup keeps a parent vault's view consistent.
- **Encrypted KeyVault** — AES-256-GCM with versioned `SGV2\x01` envelope. Master password required to unlock; OAuth refresh tokens + API keys stay encrypted at rest.
- **OAuth (PKCE) + API-key integrations** — Google Workspace, Microsoft 365, Notion, Twilio, plus Copilot providers (Anthropic, OpenAI, Ollama, LM Studio, NVIDIA NIM). Bring-your-own OAuth clients — no shared Sauce-CRM app.
- **Auto model indexing** — Copilot picker enumerates Ollama `/api/tags`, LM Studio `/v1/models`, NIM, and curated cloud lists. Refresh button busts the 30s cache.
- **Structured telemetry** — every meaningful event lands in `.sauce/memory/TRACE-LOG.jsonl` via Obsidian's vault adapter. Filterable by level (trace/debug/info/warn/error); in-memory ring buffer fallback.
- **CRM/ERP UI system** — modal-first capture for notes, ideas, observations, tasks, events, ledger entries, and pipeline deals; dashboard, calendar, task board, inbox, ledger, graph, heatmap, and Kanban views stay live as vault files change.
- **Enterprise policy scaffold** — `_POLICY.md` and `PARENT-VAULT.md` define domain, department, founder-group, role, permission, approval, and upstream rollup rules for multi-user deployments.

## Install

### From the community browser (after marketplace acceptance)

`Settings → Community Plugins → Browse → search "Sauce CRM" → Install`.

### Manual install

1. Download `main.js`, `manifest.json`, and `styles.css` from the [latest release](https://github.com/Diatonic-OS/sauce-crm/releases/latest).
2. Drop them into `<your-vault>/.obsidian/plugins/sauce-crm/`.
3. Enable in `Settings → Community Plugins → Installed`.

### Via BRAT (for pre-release builds)

`Add Beta Plugin → Diatonic-OS/sauce-crm`. BRAT pulls the latest release automatically.

## First-run setup

1. **Settings → Sauce CRM → Copilot** — pick a provider; the model list auto-populates from that provider's catalog.
2. **Settings → Sauce CRM → Integrations** — for each external service you want to connect:
   - Click `Configure` → enter your OAuth client ID (or API key) → save to vault
   - Click `Connect` → for OAuth providers a browser tab opens; complete the consent screen; you'll see "Connected — you can close this tab."
3. **Master password** — on first vault unlock you'll set a password. This unlocks the KeyVault for the session; auto-locks after 30 min of idle.

For provider-specific OAuth client setup (Google Cloud Console, Microsoft Entra, Notion integration token), see [`docs/oauth-byo/`](docs/oauth-byo/README.md).

For the full UI and file-native record contract, see [`docs/UI-SYSTEM.md`](docs/UI-SYSTEM.md).

## Hotkeys (defaults)

| Hotkey | Command |
|---|---|
| `Cmd+Shift+P` | New Person |
| `Cmd+Shift+O` | New Org |
| `Cmd+Shift+T` | Log Touch |
| `Cmd+Shift+A` | New Addendum |
| `Cmd+Shift+I` | New Intro |
| `Cmd+E` | Edit Current |

## Development

```sh
cd plugin/
npm install
npm run dev          # esbuild watch mode
npm run typecheck    # tsc --noEmit
npm test             # vitest (24 tests as of 0.1.0)
npm run build        # production bundle → main.js
```

To install your dev build into a vault, symlink:

```sh
ln -s "$(pwd)" "<vault>/.obsidian/plugins/sauce-crm"
```

Reload Obsidian (Cmd/Ctrl+R) after each `npm run dev` rebuild.

## Privacy & data handling

- **Everything is local.** Your vault never leaves your machine. The plugin makes outbound calls only to providers you explicitly connect (Google APIs, Microsoft Graph, Notion API, Twilio, your Copilot's LLM) and to GitHub for update checks (Obsidian-driven).
- **No telemetry leaves the device.** `TRACE-LOG.jsonl` is local-only. No phone-home.
- **Credentials are encrypted.** OAuth refresh tokens and API keys live in an AES-256-GCM KeyVault behind a master password. The plain `data.json` only stores non-secret config.
- **Bring-your-own OAuth.** The plugin does not contain a shared Sauce-CRM OAuth client. You register your own apps in each provider's developer console (see [`docs/oauth-byo/`](docs/oauth-byo/README.md)).

## Disclosures

Per the [Obsidian Developer Policies](https://docs.obsidian.md/Developer+policies#Disclosures):

- **Network use.** The plugin makes outbound network requests **only to services you explicitly configure**, and **only** through Obsidian's `requestUrl` API (no raw `fetch`/`axios`). Endpoints are: LLM/Copilot providers you enable (Anthropic, OpenAI, Ollama, LM Studio, NVIDIA NIM), integration providers you connect (Google Workspace, Microsoft 365, Notion, Twilio), optional geocoding (OpenStreetMap Nominatim / Mapbox), and optional web search. No network calls are made until you turn a feature on and supply credentials.
- **Account requirements.** No "Sauce CRM" account exists — there is no sign-up and no shared backend. Integrations use **your own** OAuth apps and API keys (bring-your-own; see [`docs/oauth-byo/`](docs/oauth-byo/README.md)).
- **Credentials & external file access.** API keys and OAuth refresh tokens are encrypted (AES-256-GCM) in a local KeyVault behind a master password. The plugin reads/writes **only your vault files** plus, on **desktop only**, a local LanceDB store under your vault's config directory (offered via an opt-in install prompt).
- **Telemetry.** **No client-side/remote telemetry.** The only "telemetry" is a structured event log written **locally** to `.sauce/memory/TRACE-LOG.jsonl` in your vault. Nothing is sent to the author or any third party.
- **Payments / ads.** None.
- **Source.** Open source (MIT). Desktop-only (`isDesktopOnly: true`) because the LanceDB vector backend is a native module; mobile support is on the roadmap.

## Contributing

PRs welcome. Before submitting:

- `npm run typecheck` clean
- `npm test` green
- `npm run lint` reviewed
- New features land with a vitest covering the happy path + at least one error path
- No `console.*` in `src/` — use `plugin.logger` (eslint enforces this)
- No new secrets in `data.json` — route through `KeyVault` via `IntegrationCredentials`

## License

MIT — see [LICENSE](LICENSE).
