---
group: actions
id: schedule-touch
summary: Set a note's next_touch and register the Schedule-touch command.
platform: [desktop, mobile]
obsidian_api: Plugin.addCommand
api_version: "1.8.0"
deterministic: true
depends_on: [tools/vault-process-note, tools/command-register, helpers/frontmatter-merge, helpers/parse-yaml]
---

# actions/schedule-touch

`scheduleTouch` sets `next_touch` (a logical tick) in frontmatter atomically;
`registerScheduleTouch` exposes the palette command.

## Contract
- `scheduleTouch(vault, file, nextTick)` merges `next_touch: nextTick` into
  frontmatter via `vault-process-note`, returns the new contents.
- `registerScheduleTouch(plugin, run)` registers `Sauce: Schedule touch`.
- `obsidian_api: Plugin.addCommand` MUST exist in `apiCatalog`.
