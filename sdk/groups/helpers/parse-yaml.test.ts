import { describe, it, expect } from 'vitest';
import { parseYaml, stringifyYaml } from './parse-yaml';

describe('helpers/parse-yaml', () => {
  it('parses YAML frontmatter into an object', () => {
    expect(parseYaml<{ type: string; tags: string[] }>('type: person\ntags:\n  - a\n  - b\n')).toEqual({
      type: 'person',
      tags: ['a', 'b'],
    });
  });

  it('stringifies an object to YAML', () => {
    const out = stringifyYaml({ type: 'org', name: 'Acme' });
    expect(out).toContain('type: org');
    expect(out).toContain('name: Acme');
  });

  it('round-trips object → yaml → object', () => {
    const obj = { a: 1, b: ['x', 'y'], c: { d: true } };
    expect(parseYaml(stringifyYaml(obj))).toEqual(obj);
  });
});
