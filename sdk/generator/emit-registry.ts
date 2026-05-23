// SDK generator — source: sdk/generator/emit-registry.md | api_version: 1.8.0 | gen_hash: hand-g007
//
// GENERATOR.md stage 6: aggregate member docs into REGISTRY.md. Pure, no obsidian.

import { stableSort } from '../groups/helpers/stable-sort';

export interface MemberDescriptor {
  group: string;
  id: string;
  summary: string;
  platform: string;
}

/** Parse a member `.md`'s frontmatter; null unless both group and id are present. */
export function parseMemberDoc(markdown: string): MemberDescriptor | null {
  const fm = markdown.match(/^---\n([\s\S]*?)\n---/);
  if (!fm) return null;
  const block = fm[1];
  const group = block.match(/^group:\s*(\S+)/m)?.[1];
  const id = block.match(/^id:\s*(\S+)/m)?.[1];
  if (!group || !id) return null; // _index.md has group but no id → skip
  const summary = block.match(/^summary:\s*(.+)$/m)?.[1]?.trim() ?? '';
  const platform = block.match(/^platform:\s*(.+)$/m)?.[1]?.trim() ?? '';
  return { group, id, summary, platform };
}

/** Render the aggregated REGISTRY.md, sorted by group then id. */
export function emitRegistry(members: MemberDescriptor[]): string {
  const sorted = stableSort(stableSort(members, (m) => m.id), (m) => m.group);
  const lines: string[] = [
    '<!-- GENERATED — aggregated from sdk/groups/**/*.md member contracts. Do not edit by hand. -->',
    '# Sauce CRM SDK — Registry',
    '',
    `Total members: ${sorted.length}`,
    '',
  ];
  let currentGroup = '';
  for (const m of sorted) {
    if (m.group !== currentGroup) {
      currentGroup = m.group;
      lines.push(`## ${currentGroup}`, '', '| id | platform | summary |', '| --- | --- | --- |');
    }
    lines.push(`| \`${m.id}\` | ${m.platform} | ${m.summary} |`);
  }
  lines.push('');
  return lines.join('\n');
}
