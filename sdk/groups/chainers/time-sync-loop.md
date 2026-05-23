---
group: chainers
id: time-sync-loop
summary: Lifecycle-bound reconcile loop ordered by a logical clock (never wall-clock).
platform: [desktop, mobile]
obsidian_api: none
api_version: "1.8.0"
inputs:
  startTimeSyncLoop: "(plugin: Plugin, opts: { intervalMs; reconcile }) => TimeSyncHandle"
  reconcileRemoteClock: "(handle: TimeSyncHandle, remoteTick: number) => number"
outputs: "TimeSyncHandle { clock, intervalId }"
side_effects: [timer]
deterministic: true
depends_on: [tools/interval-register, helpers/logical-clock]
---

# chainers/time-sync-loop

The looping + time-sync backbone. `interval-register` schedules ticks
(lifecycle-cleaned); each tick advances a `LogicalClock` and calls `reconcile`
with the tick number. Cross-device convergence uses `reconcileRemoteClock`
(Lamport merge), so two devices editing the same vault order events
deterministically regardless of wall-clock skew (CONTRACT.md determinism rule 1).

## Contract
- `startTimeSyncLoop(plugin, { intervalMs, reconcile })` registers a recurring
  tick; each tick: `clock.tick()` then `reconcile(tick)`.
- `reconcileRemoteClock(handle, remoteTick)` merges a remote stamp
  (`max(local, remote)+1`), returns the new value.
- Ordering is by logical clock only; wall-clock is never used for logic.
