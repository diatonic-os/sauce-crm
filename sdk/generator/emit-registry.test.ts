import { describe, it, expect } from 'vitest';
import { parseMemberDoc, emitRegistry } from './emit-registry';

const memberDoc = `---
group: helpers
id: logical-clock
summary: Lamport logical clock.
platform: universal
---
# body`;

const indexDoc = `---
group: helpers
summary: pure functions
---
# index (no id)`;

describe('generator/emit-registry', () => {
  it('parses a member doc into a descriptor', () => {
    expect(parseMemberDoc(memberDoc)).toEqual({
      group: 'helpers',
      id: 'logical-clock',
      summary: 'Lamport logical clock.',
      platform: 'universal',
    });
  });

  it('skips _index docs (group but no id) → null', () => {
    expect(parseMemberDoc(indexDoc)).toBeNull();
  });

  it('returns null for docs without frontmatter', () => {
    expect(parseMemberDoc('# Just a heading')).toBeNull();
  });

  it('emits a registry grouped + sorted, with a total count', () => {
    const md = emitRegistry([
      { group: 'tools', id: 'b-tool', summary: 'B', platform: 'universal' },
      { group: 'helpers', id: 'a-help', summary: 'A', platform: 'universal' },
      { group: 'tools', id: 'a-tool', summary: 'A', platform: 'universal' },
    ]);
    expect(md).toContain('Total members: 3');
    expect(md.indexOf('## helpers')).toBeLessThan(md.indexOf('## tools')); // groups sorted
    expect(md.indexOf('a-tool')).toBeLessThan(md.indexOf('b-tool')); // ids sorted within group
    expect(md).toContain('| `a-help` | universal | A |');
  });
});
