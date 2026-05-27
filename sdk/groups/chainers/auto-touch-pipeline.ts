// SDK chainer — source: sdk/groups/chainers/auto-touch-pipeline.md | api_version: 1.8.0 | gen_hash: hand-c003
//
// Record a touch into frontmatter atomically; idempotent via logical clock.

import { Vault, TFile } from 'obsidian';
import { processNote } from '../tools/vault-process-note';
import { mergeFrontmatter, Frontmatter } from '../helpers/frontmatter-merge';
import { parseYaml, stringifyYaml } from '../helpers/parse-yaml';

export interface TouchEvent {
  tick: number;
  channel: string;
}

const FM_RE = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/;

/** Atomically merge a touch into the note's frontmatter; idempotent when tick<=last. */
export async function applyTouch(vault: Vault, file: TFile, event: TouchEvent): Promise<string> {
  return processNote(vault, file, (content) => {
    const m = content.match(FM_RE);
    const existing: Frontmatter = m ? ((parseYaml(m[1]!) as Frontmatter) ?? {}) : {}; // safe: regex requires group 1 on match
    const body = m ? m[2]! : content; // safe: regex requires group 2 on match
    const lastTouch = Number(existing.last_touch) || 0;
    if (event.tick <= lastTouch) return content; // already applied — idempotent
    const merged = mergeFrontmatter(existing, {
      last_touch: event.tick,
      touch_count: (Number(existing.touch_count) || 0) + 1,
      last_channel: event.channel,
    });
    return `---\n${stringifyYaml(merged)}---\n\n${body.replace(/^\n+/, '')}`;
  });
}
