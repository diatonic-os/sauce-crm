---
group: actions
id: quick-capture
summary: Capture a note with merged frontmatter; register it as a command.
platform: [desktop, mobile]
obsidian_api: Plugin.addCommand
api_version: "1.8.0"
inputs:
  quickCapture: "(vault: Vault, input: QuickCaptureInput) => Promise<TFile>"
  registerQuickCapture: "(plugin: Plugin, run: () => void) => Command"
outputs: "the created TFile / registered Command"
side_effects: [vault.write, ui]
deterministic: true
depends_on:
  [tools/command-register, tools/vault-create-note, helpers/frontmatter-merge, helpers/parse-yaml, helpers/normalize-path]
---

# actions/quick-capture

First user-facing action. Composes the lower tiers: builds a frontmatter block
(`frontmatter-merge` + `stringifyYaml`), resolves a path (`joinPath`), writes the
note (`vault-create-note`), and exposes a palette command
(`command-register`). Works identically on desktop and mobile.

## Contract
- `quickCapture(vault, { folder, title, body?, frontmatter? })` writes
  `folder/title.md` with a YAML frontmatter block (defaults `{ type: "note" }`
  merged under caller frontmatter) followed by the body; returns the `TFile`.
- No wall-clock in frontmatter (determinism — timestamps are the caller's job
  via `logical-clock`).
- `registerQuickCapture(plugin, run)` registers the `Sauce: Quick capture`
  command bound to `run`.
