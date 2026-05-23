# I am submitting a new Community Plugin

<!-- CON-OBS-INTEG-001 · SH-I (T-I-02). Paste-ready body for a PR against
     iamdrewfortini/obsidian-releases (fork of obsidianmd/obsidian-releases),
     adding sauce-crm to community-plugins.json. Author the PR manually. -->

## Repo URL

Link to my plugin: https://github.com/Diatonic-OS/sauce-crm

## Release Checklist

- [x] I have tested the plugin on
  - [x] Windows
  - [x] macOS
  - [x] Linux
  - [ ] Android *(degraded — the LanceDB graph/index backend is desktop-only; core notes still render)*
  - [ ] iOS *(degraded — see above)*
- [x] My GitHub release contains all required files
  - [x] `main.js`
  - [x] `manifest.json`
  - [x] `styles.css` *(ships tokenized custom CSS)*
- [x] GitHub release name matches the exact version number in `manifest.json` (no `v` prefix)
- [x] The `id` in my `manifest.json` (`sauce-crm`) matches the `id` in the `community-plugins.json` entry
- [x] My release is tagged with the version number (e.g. `0.3.0`)
- [x] `minAppVersion` is set to `1.5.0` and the release works on it
- [x] I have a `README.md` documenting setup + usage
- [x] I have a `LICENSE` (MIT)
- [x] My plugin does not use deprecated/internal APIs without a fallback
- [x] No secrets/keys are committed; credentials live in an encrypted KeyVault

## What the plugin does

**Sauce CRM** turns an Obsidian vault into a relationship CRM with a typed,
contract-validated entity surface and a public service layer downstream plugins
can inherit.

- **14-entity relationship graph** — people, orgs, touches, addenda, tasks,
  ideas, playbooks, templates, vaults, pipelines, observations, notes, ledger,
  events — backed by LanceDB (`graph_nodes` / `graph_edges`, bidirectional).
- **State-aware plugin inheritance** — Install→Optimize buttons that detect and
  optimize Obsidian core + community plugins (Tasks, Dataview, Kanban, Meta Bind,
  QuickAdd, BRAT) for Sauce, with idempotent `data.json` configuration.
- **Canonization** — `.md` files marked `sauce.canonized: true` become a
  read-only graph projection, mutable only through a hash-chained mutation
  contract (audited, secret-redacted, event-emitting).
- **Public `svcV1`** — `app.plugins.plugins['sauce-crm'].svcV1`, a semver-stable
  (`0.3.0`) facade exposing entities/touches/pipelines/graph/canon/events/tasks
  + register hooks. See [`docs/services-api.md`](https://github.com/Diatonic-OS/sauce-crm/blob/main/docs/services-api.md).
- **Copilot** — live model indexing across Anthropic, OpenAI, Ollama, LM Studio,
  and NVIDIA NIM; RAG over the vault; encrypted KeyVault for OAuth + API keys.

## Screenshots

<!-- Replace with real screenshots before submitting:
     1. Settings → Integrations (Services | Community Plugins | Core Plugins tabs)
     2. A canonized entity view (read-only projection)
     3. The relationship graph view -->

| Integrations settings | Canonized entity | Relationship graph |
|---|---|---|
| _(add screenshot)_ | _(add screenshot)_ | _(add screenshot)_ |

## Notes for reviewers

- Desktop-first: the LanceDB backend auto-installs on desktop; on mobile the
  plugin degrades to vault-only features.
- No telemetry. No donation prompts inside the plugin UI (sponsor info lives in
  the README and `SPONSORS.md` only).
- CI runs lint + typecheck + tests + `sdk:check` + build on every PR.
