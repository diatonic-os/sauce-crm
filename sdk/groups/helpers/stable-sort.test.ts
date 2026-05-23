import { describe, it, expect } from 'vitest';
import { stableSort } from './stable-sort';

describe('helpers/stable-sort', () => {
  it('sorts ascending by numeric key', () => {
    expect(stableSort([3, 1, 2], (n) => n)).toEqual([1, 2, 3]);
  });

  it('sorts ascending by string key (code-unit, locale-independent)', () => {
    expect(stableSort(['b', 'a', 'c'], (s) => s)).toEqual(['a', 'b', 'c']);
  });

  it('is stable: equal keys keep original relative order', () => {
    const input = [
      { g: 'x', n: 1 },
      { g: 'x', n: 2 },
      { g: 'a', n: 3 },
      { g: 'x', n: 4 },
    ];
    expect(stableSort(input, (i) => i.g).map((i) => i.n)).toEqual([3, 1, 2, 4]);
  });

  it('does not mutate the input', () => {
    const input = [3, 1, 2];
    stableSort(input, (n) => n);
    expect(input).toEqual([3, 1, 2]);
  });

  it('is deterministic across repeated runs', () => {
    const data = [{ k: 'b' }, { k: 'a' }, { k: 'b' }, { k: 'a' }];
    const once = stableSort(data, (d) => d.k);
    const twice = stableSort(data, (d) => d.k);
    expect(once).toEqual(twice);
  });
});
