// SDK action — source: sdk/groups/actions/quick-capture.md | api_version: 1.8.0 | gen_hash: hand-a001
//
// Capture a note with merged frontmatter; expose as a command. Composes tools+helpers.

import { Plugin, Vault, TFile, Command } from 'obsidian';
import { createNote } from '../tools/vault-create-note';
import { registerCommand } from '../tools/command-register';
import { mergeFrontmatter, Frontmatter } from '../helpers/frontmatter-merge';
import { stringifyYaml } from '../helpers/parse-yaml';
import { joinPath } from '../helpers/normalize-path';

export interface QuickCaptureInput {
  folder: string;
  title: string;
  body?: string;
  frontmatter?: Frontmatter;
}

/** Write `folder/title.md` with a frontmatter block + body; returns the TFile. */
export async function quickCapture(vault: Vault, input: QuickCaptureInput): Promise<TFile> {
  const fm = mergeFrontmatter({ type: 'note' }, input.frontmatter ?? {});
  const path = joinPath(input.folder, `${input.title}.md`);
  const content = `---\n${stringifyYaml(fm)}---\n\n${input.body ?? ''}`;
  return createNote(vault, path, content);
}

/** Register the Quick capture command bound to `run`. */
export function registerQuickCapture(plugin: Plugin, run: () => void): Command {
  return registerCommand(plugin, { id: 'sauce-quick-capture', name: 'Sauce: Quick capture', callback: run });
}
