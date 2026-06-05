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
npm test             # vitest (919 tests across 155 files as of 0.3.0)
npm run build        # production bundle → main.js
```

To install your dev build into a vault, symlink:

```sh
ln -s "$(pwd)" "<vault>/.obsidian/plugins/sauce-crm"
```

Reload Obsidian (Cmd/Ctrl+R) after each `npm run dev` rebuild.

## Privacy & data handling

- **Everything is local.** Your vault never leaves your machine. The plugin makes outbound calls only to providers you explicitly connect (Google APIs, Microsoft Graph, Notion API, Twilio, your Copilot's LLM, optional web-search and geocoding providers) and to GitHub for update checks (Obsidian-driven). See [Network use](#disclosures) for the full endpoint list.
- **No telemetry leaves the device.** `TRACE-LOG.jsonl` is local-only. No phone-home.
- **Credentials are protected.** OAuth refresh tokens and API keys live in the OS keychain (Electron `safeStorage`) or, as a fallback, in an AES-256-GCM KeyVault behind a master password. The plain `data.json` only stores non-secret config.
- **Bring-your-own OAuth.** The plugin does not contain a shared Sauce-CRM OAuth client. You register your own apps in each provider's developer console (see [`docs/oauth-byo/`](docs/oauth-byo/README.md)).

## Disclosures

Per the [Obsidian Developer Policies](https://docs.obsidian.md/Developer+policies#Disclosures):

- **Network use.** The plugin makes outbound network requests **only to services you explicitly configure**. Every integration is **opt-in and default-off**; no network call is made until you turn a feature on and supply credentials. Transport is Obsidian's `requestUrl` API for ordinary request/response calls, plus the Electron renderer's **native `fetch()`** in two narrow cases where `requestUrl` cannot stream incrementally: Copilot **token streaming** (`src/saucebot/SauceBotHostAdapters.ts`, SSE/NDJSON) and **live model-catalog** enumeration (`src/saucebot/ModelCatalog.ts`). The full set of endpoints the plugin can reach, each only when you enable and configure it:
  - **Copilot / LLM providers:** Anthropic (`api.anthropic.com`), OpenAI (`api.openai.com`), NVIDIA NIM (`integrate.api.nvidia.com`), OpenRouter (`openrouter.ai`), Groq (`api.groq.com`), Google Gemini (`generativelanguage.googleapis.com`), Ollama (local endpoint you set), LM Studio (local endpoint you set).
  - **Integration providers:** Google Workspace (`*.googleapis.com`, `accounts.google.com`, `oauth2.googleapis.com`), Microsoft 365 (`graph.microsoft.com`, `login.microsoftonline.com`), Notion (`api.notion.com`), Twilio (`api.twilio.com`), and any SMTP/IMAP server you configure for the mail integration.
  - **Optional web search:** Brave Search (`api.search.brave.com`), Tavily (`api.tavily.com`), DuckDuckGo HTML (`html.duckduckgo.com`).
  - **Optional geocoding:** OpenStreetMap Nominatim (`nominatim.openstreetmap.org`), Mapbox (`api.mapbox.com`).
  - **Update checks:** GitHub releases (Obsidian-driven, for BRAT / manual update flows).

  All of the above are off by default. No telemetry, analytics, or phone-home traffic leaves the machine (see Telemetry below).
- **Account requirements.** No "Sauce CRM" account exists — there is no sign-up and no shared backend. Integrations use **your own** OAuth apps and API keys (bring-your-own; see [`docs/oauth-byo/`](docs/oauth-byo/README.md)).
- **Credentials & external file access.** API keys and OAuth refresh tokens are stored either in the OS keychain (Electron `safeStorage`) or, as a fallback, in the encrypted (AES-256-GCM) local KeyVault behind a master password — never in `data.json` (see Secrets below). The plugin reads/writes **only your vault files** plus, on **desktop only**, a local LanceDB store kept in a **central per-user data directory outside the vault** (so its many index files don't churn your vault sync/watchers) and the keychain-bound secrets file alongside it. LanceDB is a native module and is **not** installed automatically: the plugin detects whether it is present and, if not, shows a copyable `npm install @lancedb/lancedb --prefix <dir>` command you run yourself in a terminal, then re-checks for the install. Lexical search works without it.
- **Local executables (opt-in).** The optional voicenote-transcription skill runs a **whisper CLI you have already installed yourself** (it is never downloaded or installed by the plugin); if the binary is absent the skill reports it and does nothing. The plugin never downloads or executes code from the network.
- **Local network listener (opt-in, default-off).** The optional mobile-memory bridge starts a **local HTTP listener** (HMAC-authenticated, pairing-token gated, intended for your own Tailscale/LAN devices) so the mobile app can query the desktop LanceDB memory. It binds only when you enable the bridge in Settings and stops on plugin unload.
- **Telemetry.** **No client-side/remote telemetry.** The only "telemetry" is a structured event log (`TelemetrySink`) written **locally** to `.sauce/memory/TRACE-LOG.jsonl` via Obsidian's vault adapter, with an in-memory ring-buffer fallback when the adapter is unavailable. It is never transmitted off the device; nothing is sent to the author or any third party.
- **Secrets.** API keys and OAuth refresh tokens live in the OS keychain (Electron `safeStorage`) or, where that is unavailable, in the encrypted KeyVault. They are **never** written to `data.json` — `data.json` holds only non-secret configuration.
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

## Sponsors

Sauce CRM is free and open source (MIT) — no paywalled tier, no telemetry. If it
saves you time, sponsoring keeps the roadmap moving and the integrations
maintained. Sponsorship is **optional and never gates a feature**; per our
guardrails there are no donation prompts inside the plugin (this section and
`SPONSORS.md` are the only places we ask).

[**❤ Sponsor on GitHub**](https://github.com/sponsors/iamdrewfortini) · see [`SPONSORS.md`](SPONSORS.md) for tiers & perks.

| Tier | / month | Highlights |
|------|---------|-----------|
| ☕ Supporter | $5 | Sponsor badge · Discord `#supporters` |
| 🌶️ Sponsor | $25 | + BRAT beta channel · quarterly roadmap survey |
| 🔧 Contributor | $100 | + name in `SPONSORS.md` · quarterly roadmap call |
| 🛠️ Maintainer | $500 | + logo here · integration request priority · direct support |

Beta builds ship through [BRAT](#via-brat-for-pre-release-builds) to sponsors who
enable the beta channel (`saucecrm.beta.enabled`, default off).

## License

MIT — see [LICENSE](LICENSE).
