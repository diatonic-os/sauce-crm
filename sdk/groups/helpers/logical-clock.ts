// SDK helper — source: sdk/groups/helpers/logical-clock.md | api_version: 1.8.0 | gen_hash: hand-0001
//
// Lamport logical clock. Pure, deterministic, no wall-clock. See
// sdk/CONTRACT.md determinism rule 1 and sdk/groups/helpers/logical-clock.md.

/** A Lamport logical clock: monotonic ordering across devices without wall time. */
export class LogicalClock {
  private counter: number;

  constructor(initial = 0) {
    if (!Number.isInteger(initial) || initial < 0) {
      throw new RangeError(`LogicalClock initial must be a non-negative integer, got ${initial}`);
    }
    this.counter = initial;
  }

  /** Local event: increment and return the new value. */
  tick(): number {
    this.counter += 1;
    return this.counter;
  }

  /** Receive event: advance past a remote stamp (Lamport rule), return new value. */
  merge(remote: number): number {
    if (!Number.isInteger(remote) || remote < 0) {
      throw new RangeError(`LogicalClock merge expects a non-negative integer, got ${remote}`);
    }
    this.counter = Math.max(this.counter, remote) + 1;
    return this.counter;
  }

  /** Current value without mutation. */
  current(): number {
    return this.counter;
  }
}
