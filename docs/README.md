# Sauce Graph

A typed-edge relationship graph for [Obsidian](https://obsidian.md). Sauce Graph turns a markdown vault into a contract-validated property graph of people, organizations, touches (interactions), and addenda — usable as a personal CRM, founder warm-network tracker, or research knowledge base.

## What is Sauce Graph

Sauce Graph layers four capabilities on top of vanilla Obsidian:

1. **Typed entities** — every relevant `.md` file declares a `type` (`warm-contact`, `org`, `subsidiary`, `touch`, `addendum`) and a contract level (`simple`, `core`, `extended`, `full`).
2. **A property graph** — `knows`, `worked_with`, `intro_via`, `referral_to`, `company` and other wikilink fields form typed edges that are auto-reconciled between files.
3. **Contract validation** — each entity carries a small first-order predicate (`constrains:`) that the validator evaluates before save. Violations surface as warnings or hard blocks depending on `strictness`.
4. **Federation** — multiple SubVaults can roll up under one ParentVault using the LSP (Language-Server-Protocol-style) universe-superclass model. See [federation.md](federation.md).

## Why use it

- **Vanilla markdown.** All canonical state lives in `.md` frontmatter; LanceDB stores the derived mirror, vectors, audit rows, and provenance under the plugin folder. No proprietary source-of-truth file format.
- **Deterministic edges.** Add `Alice` to Bob's `knows:` list — Bob is auto-added to Alice's.
- **Auditable.** Optional HMAC-SHA256 audit chain over every mutation; verifiable from a single command.
- **Local-first AI.** The copilot can run against LM Studio or Ollama; cloud providers (OpenAI, Anthropic) are escalation, not default.
- **No regex on user input.** The contract validator uses a tiny glob grammar (`.+` only) — see [contracts.md](contracts.md). No ReDoS surface.

## Quick start

1. Drop the plugin into `.obsidian/plugins/sauce-graph/` and enable it in Settings → Community plugins.
2. Run **`Sauce: Initialize Vault`** (command palette) — creates the canonical folder scaffold under `people/`, `orgs/`, `touches/`, `addenda/`, plus `_PLUGIN-CONFIG.md`.
3. Run **`Sauce: New Person`** (Cmd/Ctrl-Shift-P) and **`Sauce: New Org`** (Cmd/Ctrl-Shift-O) to seed your first entities.
4. Open the dashboards: **`Sauce: Open Dashboard`**, **`Sauce: Open Pipeline Kanban`**, **`Sauce: Open Typed-Edge Graph`**.
5. Optional: **`Sauce: Initialize Parent Vault`** if you plan to federate multiple vaults.

## Core concepts

### LSP type hierarchy

Every entity has a `subtype_of:` field that names a parent type (`Entity` at the root). The hierarchy is open — you can declare `subtype_of: Person.Founder` in a SubVault and the parent will treat unknown subtypes as opaque extensions of `Person`. See [federation.md](federation.md) for how this interacts with the universe-superclass merge rule.

### Contracts

Each entity declares a contract level and a list of `constrains:` propositions. Levels:

- `nosubtype` — skip subtype checks
- `subtype` — only validate subtype membership
- `simple` — default for people/orgs; checks declared `constrains:`
- `core` — adds immutability checks (touches, addenda)
- `extended` — adds cross-file edge symmetry
- `full` — everything plus federation gates

See [contracts.md](contracts.md) for the predicate grammar and worked examples.

### Edge sync

Edge fields (`knows`, `worked_with`, `intro_via`, …) are reconciled on `metadataCache.changed`. The plugin maintains a rule table (`edge_rules` in settings) that defines which field on which type mirrors to which field on which type. Bidirectional by default for `knows` and `worked_with`; directional for `intro_via` and `referral_to`.

## Command reference

See [commands.md](commands.md) for the full list of 50+ commands, their command IDs, default hotkeys, and one-line descriptions. Headline commands:

| Command | Hotkey |
|---|---|
| New Person | Cmd/Ctrl-Shift-P |
| New Org | Cmd/Ctrl-Shift-O |
| Log Touch | Cmd/Ctrl-Shift-T |
| Edit Current Note | Cmd/Ctrl-E |
| Quick Capture (CDEL) | Cmd/Ctrl-K |

## Settings overview

The settings tab (`Settings → Sauce Graph`) exposes:

- **Paths** — folder names for each entity type
- **Strictness** — `block` / `warn` / `log` (controls contract enforcement)
- **Edge rules** — bidirectional/directional config per field
- **Compatibility** — admissibility threshold `ρ_adm` and which fields contribute
- **Federation** — cross-vault edges, enum resolution mode, validation gate
- **Enums** — closed value sets for `primary_type`, `roles`, `cadence`, `channel`, `playbook_used`, `outcome_tag`, `status` (org), `kind` (addendum)
- **Copilot** — provider selection (LM Studio / Ollama / OpenAI / Anthropic), model, autonomy default
- **Integrations** — see [integrations.md](integrations.md)
- **Security** — KeyVault unlock, audit log, proxy mode; see [SECURITY.md](SECURITY.md)

## Privacy & security note

By default Sauce Graph runs entirely locally. Nothing is sent to any third party unless you explicitly configure a cloud LLM provider or an integration (Google, Microsoft, etc.) and unlock the KeyVault. Integration tokens are stored in an AES-256-GCM-encrypted secret store keyed off a user-supplied master password. See [SECURITY.md](SECURITY.md) for the threat model.

## FAQ

**Does it work on Obsidian mobile?**
The plugin compiles for mobile, but the V2 SQLite backend is desktop-only; on mobile the secret store falls back to an encrypted blob in `data.json`. Edge sync, validation, and copilot all function on mobile.

**Can I disable the copilot?**
Yes — `Settings → Sauce Graph → Copilot → enabled: false`. The graph layer is fully usable without any LLM.

**What happens if I open a vault that has Sauce-formatted frontmatter but the plugin isn't installed?**
Nothing. The frontmatter is plain YAML; vanilla Obsidian ignores it.

**Can I round-trip to other tools?**
Yes. **`Sauce: Export Graph JSON`** dumps the full vault to a single `_graph-export-YYYY-MM-DD.json` file. **`Sauce: Import…`** ingests CSV, vCard, ICS, and JSON via a mapping UI.

**Where does the audit chain live?**
In the plugin's SQLite mirror at `.obsidian/plugins/sauce-graph/sauce.db`, one row per mutation, HMAC-chained. Run **`Sauce: Verify Audit Chain`** to walk it.
