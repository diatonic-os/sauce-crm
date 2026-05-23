// SDK chainer — source: sdk/groups/chainers/time-sync-loop.md | api_version: 1.8.0 | gen_hash: hand-c002
//
// Looping + time-sync backbone: interval-register ticks + logical-clock ordering.

import { Plugin } from 'obsidian';
import { LogicalClock } from '../helpers/logical-clock';
import { registerInterval } from '../tools/interval-register';

export interface TimeSyncOptions {
  intervalMs: number;
  reconcile: (tick: number) => void | Promise<void>;
}

export interface TimeSyncHandle {
  clock: LogicalClock;
  intervalId: number;
}

/** Start a lifecycle-bound reconcile loop; each tick advances the logical clock. */
export function startTimeSyncLoop(plugin: Plugin, opts: TimeSyncOptions): TimeSyncHandle {
  const clock = new LogicalClock();
  const intervalId = registerInterval(
    plugin,
    () => {
      const tick = clock.tick();
      void opts.reconcile(tick);
    },
    opts.intervalMs,
  );
  return { clock, intervalId };
}

/** Merge a remote device's clock stamp (Lamport); returns the new local value. */
export function reconcileRemoteClock(handle: TimeSyncHandle, remoteTick: number): number {
  return handle.clock.merge(remoteTick);
}
