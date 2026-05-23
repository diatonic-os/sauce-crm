---
group: helpers
id: logical-clock
summary: Lamport logical clock for deterministic cross-device ordering without wall-clock.
platform: universal
obsidian_api: none
api_version: "1.8.0"
inputs:
  tick: "() => number"
  merge: "(remote: number) => number"
  current: "() => number"
outputs: "monotonically non-decreasing integer timestamps"
side_effects: none
deterministic: true
depends_on: []
---

# helpers/logical-clock

A pure Lamport clock. Time-sync and looping logic in `chainers/` order events by
this clock, **never** wall-clock — two devices editing the same vault must
converge deterministically regardless of skew (`CONTRACT.md` determinism rule 1).

## Contract
- `tick()` increments and returns the local counter (local event).
- `merge(remote)` sets the counter to `max(local, remote) + 1` and returns it
  (receive event; Lamport rule).
- `current()` returns the counter without mutating.
- Counter starts at 0; values are monotonically non-decreasing.
- No `Date.now()` / wall-clock anywhere.
