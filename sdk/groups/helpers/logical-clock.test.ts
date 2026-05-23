import { describe, it, expect } from 'vitest';
import { LogicalClock } from './logical-clock';

describe('helpers/logical-clock', () => {
  it('starts at 0 and ticks monotonically', () => {
    const c = new LogicalClock();
    expect(c.current()).toBe(0);
    expect(c.tick()).toBe(1);
    expect(c.tick()).toBe(2);
    expect(c.current()).toBe(2);
  });

  it('merge applies the Lamport rule: max(local, remote) + 1', () => {
    const c = new LogicalClock(3);
    expect(c.merge(7)).toBe(8); // max(3,7)+1
    expect(c.merge(2)).toBe(9); // max(8,2)+1
  });

  it('is deterministic: identical operation sequences converge', () => {
    const seq = (start: number) => {
      const c = new LogicalClock(start);
      c.tick();
      c.merge(5);
      c.tick();
      return c.current();
    };
    expect(seq(0)).toBe(seq(0));
    expect(seq(0)).toBe(7); // 0→1→merge(5)=6→7
  });

  it('rejects invalid inputs', () => {
    expect(() => new LogicalClock(-1)).toThrow(RangeError);
    expect(() => new LogicalClock(1.5)).toThrow(RangeError);
    expect(() => new LogicalClock().merge(-1)).toThrow(RangeError);
  });
});
