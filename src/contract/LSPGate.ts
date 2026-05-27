// LSPGate — the contract substrate.
//
// Holds the registry of LSPContract<T> + MethodContract[] specs, performs
// structural subtype verification, and gates runtime entry to a contract
// via OPEN / LOCKED / FROZEN states. Callers invoke `respect()` to run a
// function under a contract; if the contract is LOCKED the call queues
// FIFO until the contract is unlocked (or the per-call timeout fires).
// FROZEN contracts reject immediately.
//
// Pairs with QuorumCouncil — QuorumCouncil.propose() locks a contract,
// gathers votes, and unlocks on PASSED. LSPGate has no knowledge of the
// council; it just exposes lock/unlock/freeze primitives.

import {
  ContractId,
  LockState,
  LSPContract,
  MethodContract,
  SubtypeReport,
} from "./types";

export interface RespectOptions {
  // ms to wait for a LOCKED contract before rejecting.
  // Default: 30_000. Set 0 to never wait (fail-fast).
  timeoutMs?: number;
}

interface ContractRecord<T> {
  contract: LSPContract<T>;
  methods: MethodContract[];
  state: LockState;
  lockedBy?: string;
  lockedReason?: string;
  frozenReason?: string;
  waiters: Array<{
    resolve: () => void;
    reject: (err: Error) => void;
    timer: ReturnType<typeof setTimeout> | null;
  }>;
}

export interface LSPGateSnapshot {
  contracts: Array<{
    id: ContractId;
    state: LockState;
    lockedBy?: string;
    lockedReason?: string;
    frozenReason?: string;
    waiters: number;
  }>;
}

export class LSPGate {
  private readonly contracts = new Map<ContractId, ContractRecord<unknown>>();

  /**
   * Register a contract together with the method shapes implementations
   * must satisfy. Re-registering an existing id replaces the spec and
   * resets the state to OPEN (waiters drained as a rejected error so
   * stale calls do not silently hang).
   */
  registerContract<T>(
    contract: LSPContract<T>,
    methods: MethodContract[] = [],
  ): void {
    const existing = this.contracts.get(contract.id);
    if (existing) {
      for (const w of existing.waiters) {
        if (w.timer) clearTimeout(w.timer);
        w.reject(new Error(`contract re-registered: ${contract.id}`));
      }
    }
    const rec: ContractRecord<T> = {
      contract,
      methods,
      state: LockState.OPEN,
      waiters: [],
    };
    this.contracts.set(contract.id, rec as ContractRecord<unknown>);
  }

  /**
   * Structural subtype check. Returns a SubtypeReport whose `subtypes`
   * array is empty iff every required method exists on impl with at
   * least the declared arity. Missing/short methods appear as
   * "<method>: missing" / "<method>: arity<N expected M>" entries.
   */
  verify<T>(contract: LSPContract<T>, impl: unknown): SubtypeReport {
    const rec = this.contracts.get(contract.id);
    const methods = rec?.methods ?? [];
    const failures: string[] = [];
    const implRec = impl as Record<string, unknown> | null;
    if (implRec === null || typeof implRec !== "object") {
      return {
        supertype: contract.id,
        subtypes: ["impl: not-an-object"],
      };
    }
    for (const m of methods) {
      const fn = implRec[m.method];
      if (typeof fn !== "function") {
        failures.push(`${m.method}: missing`);
        continue;
      }
      const expected = m.params.length;
      // Function.length excludes rest params and params with defaults;
      // accept >= expected OR a rest-param signature (length 0..expected).
      const actual = (fn as (...a: unknown[]) => unknown).length;
      if (actual > expected) {
        failures.push(`${m.method}: arity<${actual} expected ${expected}>`);
      }
    }
    return {
      supertype: contract.id,
      subtypes: failures,
    };
  }

  /**
   * Run `fn` under a contract. Resolves with the function's value when
   * the contract is OPEN. If LOCKED, queues the call FIFO until unlock.
   * If FROZEN, rejects immediately. If a per-call timeout fires while
   * queued, rejects with a typed timeout error.
   */
  async respect<R>(
    contractId: ContractId,
    fn: () => R | Promise<R>,
    opts: RespectOptions = {},
  ): Promise<R> {
    const rec = this.contracts.get(contractId);
    if (!rec) {
      throw new Error(`unknown contract: ${contractId}`);
    }
    if (rec.state === LockState.FROZEN) {
      throw new Error(
        `contract FROZEN: ${contractId} (${rec.frozenReason ?? "no reason"})`,
      );
    }
    if (rec.state === LockState.LOCKED) {
      const timeoutMs = opts.timeoutMs ?? 30_000;
      await new Promise<void>((resolve, reject) => {
        const waiter: ContractRecord<unknown>["waiters"][number] = {
          resolve,
          reject,
          timer: null,
        };
        if (timeoutMs > 0) {
          waiter.timer = setTimeout(() => {
            const ix = rec.waiters.indexOf(waiter);
            if (ix >= 0) rec.waiters.splice(ix, 1);
            reject(
              new Error(
                `respect() timeout after ${timeoutMs}ms on LOCKED contract: ${contractId}`,
              ),
            );
          }, timeoutMs);
        }
        rec.waiters.push(waiter);
      });
    }
    return await fn();
  }

  /**
   * Lock a contract. New `respect()` calls queue. Idempotent — locking
   * an already-locked contract refreshes the `by`/`reason` annotations.
   * Cannot lock a FROZEN contract.
   */
  lock(id: ContractId, by: string, reason: string): void {
    const rec = this.requireRec(id);
    if (rec.state === LockState.FROZEN) {
      throw new Error(`cannot lock FROZEN contract: ${id}`);
    }
    rec.state = LockState.LOCKED;
    rec.lockedBy = by;
    rec.lockedReason = reason;
  }

  /**
   * Unlock a contract and drain queued waiters FIFO. Safe on already-OPEN
   * contracts (no-op). Throws if FROZEN.
   */
  unlock(id: ContractId): void {
    const rec = this.requireRec(id);
    if (rec.state === LockState.FROZEN) {
      throw new Error(`cannot unlock FROZEN contract: ${id}`);
    }
    rec.state = LockState.OPEN;
    delete rec.lockedBy;
    delete rec.lockedReason;
    const drained = rec.waiters.splice(0, rec.waiters.length);
    for (const w of drained) {
      if (w.timer) clearTimeout(w.timer);
      w.resolve();
    }
  }

  /**
   * Freeze a contract permanently for this process. Drains waiters with
   * a typed rejection. There is no `unfreeze` on purpose — freezing is
   * the "do not pass go" signal used after a quorum council rejects.
   */
  freeze(id: ContractId, reason: string): void {
    const rec = this.requireRec(id);
    rec.state = LockState.FROZEN;
    rec.frozenReason = reason;
    delete rec.lockedBy;
    delete rec.lockedReason;
    const drained = rec.waiters.splice(0, rec.waiters.length);
    for (const w of drained) {
      if (w.timer) clearTimeout(w.timer);
      w.reject(new Error(`contract FROZEN: ${id} (${reason})`));
    }
  }

  state(id: ContractId): LockState {
    return this.requireRec(id).state;
  }

  snapshot(): LSPGateSnapshot {
    return {
      contracts: Array.from(this.contracts.entries()).map(([id, rec]) => ({
        id,
        state: rec.state,
        ...(rec.lockedBy !== undefined && { lockedBy: rec.lockedBy }),
        ...(rec.lockedReason !== undefined && { lockedReason: rec.lockedReason }),
        ...(rec.frozenReason !== undefined && { frozenReason: rec.frozenReason }),
        waiters: rec.waiters.length,
      })),
    };
  }

  private requireRec(id: ContractId): ContractRecord<unknown> {
    const rec = this.contracts.get(id);
    if (!rec) throw new Error(`unknown contract: ${id}`);
    return rec;
  }
}
