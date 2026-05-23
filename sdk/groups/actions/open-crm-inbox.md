---
group: actions
id: open-crm-inbox
summary: Register the Open-CRM-inbox command.
platform: [desktop, mobile]
obsidian_api: Plugin.addCommand
api_version: "1.8.0"
deterministic: true
depends_on: [tools/command-register]
---

# actions/open-crm-inbox

Registers the palette command that reveals the AI inbox view (the `run`
callback wires `tools/workspace-get-leaf` + `components/inbox-view` at the
plugin layer).

## Contract
- `registerOpenInbox(plugin, run)` registers `Sauce: Open CRM inbox` bound to `run`.
- `obsidian_api: Plugin.addCommand` MUST exist in `apiCatalog`.
