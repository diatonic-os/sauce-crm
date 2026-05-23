import { describe, it, expect, vi, afterEach } from 'vitest';
import { Plugin } from 'obsidian';
import { startTimeSyncLoop, reconcileRemoteClock } from './time-sync-loop';

const makePlugin = (): Plugin => new (Plugin as unknown as { new (): Plugin })();
afterEach(() => {
  vi.useRealTimers();
});

describe('chainers/time-sync-loop', () => {
  it('ticks the logical clock and calls reconcile with increasing tick numbers', () => {
    vi.useFakeTimers();
    const ticks: number[] = [];
    const handle = startTimeSyncLoop(makePlugin(), {
      intervalMs: 1000,
      reconcile: (t) => {
        ticks.push(t);
      },
    });
    vi.advanceTimersByTime(3000);
    expect(ticks).toEqual([1, 2, 3]);
    expect(handle.clock.current()).toBe(3);
  });

  it('reconcileRemoteClock applies the Lamport merge', () => {
    vi.useFakeTimers();
    const handle = startTimeSyncLoop(makePlugin(), { intervalMs: 1000, reconcile: () => {} });
    vi.advanceTimersByTime(1000); // local clock = 1
    expect(reconcileRemoteClock(handle, 9)).toBe(10); // max(1,9)+1
    expect(handle.clock.current()).toBe(10);
  });
});
