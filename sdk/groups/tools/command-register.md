---
group: tools
id: command-register
summary: Register an Obsidian command (Plugin.addCommand) — the substrate for actions/.
platform: universal
obsidian_api: Plugin.addCommand
api_version: "1.8.0"
inputs:
  registerCommand: "(plugin: Plugin, command: Command) => Command"
outputs: "the registered Command"
side_effects: [ui]
deterministic: true
depends_on: []
---

# tools/command-register

Wraps `Plugin.addCommand`. Every `actions/` member registers through here, so
commands are hotkey-able (via `Scope`) and appear in the command palette on
desktop and mobile (`Command.mobileOnly` controls mobile visibility).

## Contract
- `registerCommand(plugin, command)` registers and returns the `Command`.
- `obsidian_api: Plugin.addCommand` MUST exist in `apiCatalog` (catalog gate).
- Universal; commands are the cross-platform action surface.
