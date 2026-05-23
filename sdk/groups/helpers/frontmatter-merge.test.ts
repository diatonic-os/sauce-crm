import { describe, it, expect } from 'vitest';
import { mergeFrontmatter } from './frontmatter-merge';

describe('helpers/frontmatter-merge', () => {
  it('patch scalar overrides base; missing keys retained', () => {
    expect(mergeFrontmatter({ a: 1, b: 2 }, { b: 3 })).toEqual({ a: 1, b: 3 });
  });

  it('unions arrays first-seen, de-duplicated', () => {
    expect(mergeFrontmatter({ tags: ['x', 'y'] }, { tags: ['y', 'z'] })).toEqual({
      tags: ['x', 'y', 'z'],
    });
  });

  it('deep-merges nested objects', () => {
    expect(mergeFrontmatter({ meta: { a: 1 } }, { meta: { b: 2 } })).toEqual({
      meta: { a: 1, b: 2 },
    });
  });

  it('output keys are sorted (stable diffs)', () => {
    expect(Object.keys(mergeFrontmatter({ z: 1, a: 1 }, { m: 1 }))).toEqual(['a', 'm', 'z']);
  });

  it('does not mutate inputs and is deterministic', () => {
    const base = { tags: ['x'] };
    const patch = { tags: ['y'] };
    const first = mergeFrontmatter(base, patch);
    const second = mergeFrontmatter(base, patch);
    expect(base).toEqual({ tags: ['x'] });
    expect(first).toEqual(second);
  });
});
