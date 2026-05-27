// SDK action — source: sdk/groups/actions/schedule-touch.md | api_version: 1.8.0 | gen_hash: hand-a002
//
// Set next_touch in frontmatter + register the Schedule-touch command.

import { Plugin, Vault, TFile, Command } from 'obsidian';
import { processNote } from '../tools/vault-process-note';
import { registerCommand } from '../tools/command-register';
import { mergeFrontmatter, Frontmatter } from '../helpers/frontmatter-merge';
import { parseYaml, stringifyYaml } from '../helpers/parse-yaml';

const FM_RE = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/;

/** Set `next_touch` (logical tick) in the note's frontmatter atomically. */
export async function scheduleTouch(vault: Vault, file: TFile, nextTick: number): Promise<string> {
  return processNote(vault, file, (content) => {
    const m = content.match(FM_RE);
    const existing: Frontmatter = m ? ((parseYaml(m[1]!) as Frontmatter) ?? {}) : {}; // safe: regex requires group 1 on match
    const body = m ? m[2]! : content; // safe: regex requires group 2 on match
    const merged = mergeFrontmatter(existing, { next_touch: nextTick });
    return `---\n${stringifyYaml(merged)}---\n\n${body.replace(/^\n+/, '')}`;
  });
}

/** Register the Schedule-touch command. */
export function registerScheduleTouch(plugin: Plugin, run: () => void): Command {
  return registerCommand(plugin, { id: 'sauce-schedule-touch', name: 'Sauce: Schedule touch', callback: run });
}
