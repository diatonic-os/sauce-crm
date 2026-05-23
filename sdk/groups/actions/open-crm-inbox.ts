// SDK action — source: sdk/groups/actions/open-crm-inbox.md | api_version: 1.8.0 | gen_hash: hand-a003
//
// Register the Open-CRM-inbox command.

import { Plugin, Command } from 'obsidian';
import { registerCommand } from '../tools/command-register';

/** Register the Open-CRM-inbox command bound to `run`. */
export function registerOpenInbox(plugin: Plugin, run: () => void): Command {
  return registerCommand(plugin, { id: 'sauce-open-inbox', name: 'Sauce: Open CRM inbox', callback: run });
}
