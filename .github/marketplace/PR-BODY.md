# I am submitting a new Community Plugin

## Repo URL

Link to my plugin: https://github.com/dacvisuals/sauce-graph

## Release Checklist

- [x] I have tested the plugin on
  - [x] Windows
  - [x] macOS
  - [x] Linux
  - [ ] Android *(not applicable — `isDesktopOnly: true`)*
  - [ ] iOS     *(not applicable — `isDesktopOnly: true`)*
- [x] My GitHub release contains all required files
  - [x] `main.js`
  - [x] `manifest.json`
  - [x] `styles.css` *(required for this plugin — ships custom CSS)*
- [x] GitHub release name matches the exact version number specified in my manifest.json (Note: Use the exact version number, don't include a prefix `v`)
- [x] The `id` in my `manifest.json` matches the `id` in the `community-plugins.json` file.
- [x] My README.md describes the plugin's purpose and provides clear usage instructions.
- [x] I have read the [tips in the developer docs](https://docs.obsidian.md/Plugins/Releases/Plugin+guidelines).
- [x] The `fundingUrl` field is **not** an empty string. *(Field is omitted entirely; we do not solicit funding.)*

## Summary of what this plugin does

Sauce CRM turns an Obsidian vault into a typed relationship-CRM workspace.
Form-driven CRUD over People, Organizations, Touches, and Addenda, with a
contract validator that keeps every entity / edge spec-compliant. Built-in
Copilot picks models live from each provider's catalog (Ollama `/api/tags`,
LM Studio `/v1/models`, NVIDIA NIM, Anthropic, OpenAI). All OAuth and API
credentials live in an AES-256-GCM KeyVault behind a master password — no
plaintext secrets in `data.json`.

Notable v2 features:

- **Structured telemetry** to `.sauce/memory/TRACE-LOG.jsonl` via Obsidian's
  vault adapter.
- **Auto model indexing** in the Copilot picker — no free-text model id input.
- **Real OAuth (PKCE)** for Google Workspace + Microsoft 365 via a loopback
  Node listener bound to an ephemeral port (49152–65535); refresh tokens
  encrypted in the KeyVault.
- **Bring-your-own OAuth client** — no shared Sauce-CRM app; users register
  their own apps in each provider's developer console.
- **24 vitest tests** covering telemetry, KeyVault crypto + envelope magic
  (SGV2), and the ModelCatalog cache.

## Why `isDesktopOnly`

The OAuth flow requires Node's `http` module (loopback listener for the
PKCE redirect) and Electron's `shell.openExternal` (browser launch). Both
are desktop-only. Mobile users can still configure API-key providers but
not OAuth ones, so we ship desktop-only and document the limitation rather
than half-supporting mobile.
