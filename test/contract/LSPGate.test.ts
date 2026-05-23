import { describe, it, expect, vi } from "vitest";
import { LSPGate } from "../../src/contract/LSPGate";
import { LockState, type LSPContract, type MethodContract } from "../../src/contract/types";

interface Person {
  greet(name: string): string;
  age(): number;
}

const personContract: LSPContract<Person> = {
  id: "test.person",
  interface: {} as Person,
};

const personMethods: MethodContract[] = [
  { method: "greet", params: ["name"], returns: "string" },
  { method: "age", params: [], returns: "number" },
];

describe("LSPGate", () => {
  it("registers a contract and reports OPEN by default", () => {
    const g = new LSPGate();
    g.registerContract(personContract, personMethods);
    expect(g.state("test.person")).toBe(LockState.OPEN);
  });

  it("verify reports missing methods", () => {
    const g = new LSPGate();
    g.registerContract(personContract, personMethods);
    const partial = { greet: (_n: string) => "hi" };
    const rep = g.verify(personContract, partial);
    expect(rep.subtypes).toContain("age: missing");
  });

  it("verify passes with full impl", () => {
    const g = new LSPGate();
    g.registerContract(personContract, personMethods);
    const full = { greet: (_n: string) => "hi", age: () => 1 };
    const rep = g.verify(personContract, full);
    expect(rep.subtypes).toEqual([]);
  });

  it("respect runs immediately when OPEN", async () => {
    const g = new LSPGate();
    g.registerContract(personContract, personMethods);
    const result = await g.respect("test.person", () => 42);
    expect(result).toBe(42);
  });

  it("respect queues while LOCKED and drains FIFO on unlock", async () => {
    const g = new LSPGate();
    g.registerContract(personContract, personMethods);
    g.lock("test.person", "tester", "exclusive write");

    const order: number[] = [];
    const p1 = g.respect("test.person", () => {
      order.push(1);
      return 1;
    });
    const p2 = g.respect("test.person", () => {
      order.push(2);
      return 2;
    });
    const p3 = g.respect("test.person", () => {
      order.push(3);
      return 3;
    });

    expect(g.snapshot().contracts[0].waiters).toBe(3);
    g.unlock("test.person");
    const results = await Promise.all([p1, p2, p3]);
    expect(results).toEqual([1, 2, 3]);
    expect(order).toEqual([1, 2, 3]);
  });

  it("respect timeout fires when contract stays LOCKED", async () => {
    vi.useFakeTimers();
    const g = new LSPGate();
    g.registerContract(personContract, personMethods);
    g.lock("test.person", "tester", "long lock");
    const p = g.respect("test.person", () => 99, { timeoutMs: 50 });
    vi.advanceTimersByTime(60);
    await expect(p).rejects.toThrow(/timeout/);
    vi.useRealTimers();
  });

  it("freeze rejects new respect() and drains queued waiters", async () => {
    const g = new LSPGate();
    g.registerContract(personContract, personMethods);
    g.lock("test.person", "tester", "wip");
    const p = g.respect("test.person", () => 1);
    g.freeze("test.person", "policy violation");
    await expect(p).rejects.toThrow(/FROZEN/);
    await expect(g.respect("test.person", () => 1)).rejects.toThrow(/FROZEN/);
  });

  it("snapshot includes lock annotations and waiter counts", () => {
    const g = new LSPGate();
    g.registerContract(personContract, personMethods);
    g.lock("test.person", "alice", "demo");
    // queue a waiter
    void g.respect("test.person", () => 1, { timeoutMs: 5_000 }).catch(() => {});
    const snap = g.snapshot();
    expect(snap.contracts[0]).toMatchObject({
      id: "test.person",
      state: LockState.LOCKED,
      lockedBy: "alice",
      lockedReason: "demo",
      waiters: 1,
    });
  });
});
