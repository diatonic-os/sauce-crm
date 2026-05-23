// SDK tool — source: sdk/groups/tools/command-register.md | api_version: 1.8.0 | gen_hash: hand-t009
//
// Register an Obsidian command. Substrate for the actions/ tier.

import { Plugin, Command } from 'obsidian';

/** Register `command` with the plugin and return it. */
export function registerCommand(plugin: Plugin, command: Command): Command {
  return plugin.addCommand(command);
}
