import { describe, it, expect } from 'vitest';
import { normalizePath, joinPath } from './normalize-path';

describe('helpers/normalize-path', () => {
  it('normalizes backslashes and collapses/trims slashes', () => {
    expect(normalizePath('a\\b')).toBe('a/b');
    expect(normalizePath('/a//b/')).toBe('a/b');
  });

  it('joins segments with / and normalizes', () => {
    expect(joinPath('people', 'Frank.md')).toBe('people/Frank.md');
    expect(joinPath('orgs/', '/Acme')).toBe('orgs/Acme');
  });

  it('skips blank segments', () => {
    expect(joinPath('people', '', '  ', 'Frank.md')).toBe('people/Frank.md');
  });

  it('is deterministic', () => {
    expect(joinPath('a', 'b', 'c')).toBe(joinPath('a', 'b', 'c'));
  });
});
