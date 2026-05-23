import { describe, expect, it, vi } from "vitest";
import {
  MutationContract,
  defaultRedactor,
  ulid,
  type LedgerEntry,
  type LedgerSink,
} from "../../src/services/MutationContract";

// Deterministic fake sha256: just tags the input length + a marker.
const fakeCrypto = { sha256Hex: async (s: string) => `h(${s.length})` };

function memLedger(): LedgerSink & { entries: LedgerEntry[] } {
  const entries: LedgerEntry[] = [];
  return {
    entries,
    lastHash: async () => entries.at(-1)?.hash ?? "",
    append: async (e) => void entries.push(e),
  };
}

describe("defaultRedactor", () => {
  it("strips obvious secrets (G-004/G-009) but keeps ordinary text", () => {
    const out = defaultRedactor.redact(
      "key sk-ABC123DEF456GHI789JKL and Bearer abcdef123456 token",
    );
    expect(out).not.toContain("sk-ABC123DEF456GHI789JKL");
    expect(out).not.toContain("abcdef123456");
    expect(out).toContain("‹redacted›");
    expect(defaultRedactor.redact("hello world")).toBe("hello world");
  });
});

describe("ulid", () => {
  it("produces 26-char Crockford base32, monotonic-ish and unique", () => {
    const a = ulid();
    const b = ulid();
    expect(a).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(a).not.toBe(b);
  });
});

describe("MutationContract", () => {
  function mk(
    over: Partial<ConstructorParameters<typeof MutationContract>[0]> = {},
  ) {
    const ledger = memLedger();
    const events: Array<{ id: string; type: string }> = [];
    const mc = new MutationContract({
      ledger,
      crypto: fakeCrypto,
      emitEvent: (e) => void events.push({ id: e.id, type: e.type }),
      actor: "tester",
      now: () => "2026-05-23T00:00:00Z",
      ulid: () => "0000000000000000000000TEST",
      ...over,
    });
    return { mc, ledger, events };
  }

  it("appends a ledger entry with the sha256(prevHash + delta) chain (R-007)", async () => {
    const { mc, ledger } = mk();
    const apply = vi.fn(async () => {});
    await mc.write({
      entityId: "person-1",
      entityType: "warm-contact",
      action: "update",
      delta: { name: "Alice" },
      apply,
    });
    const e = ledger.entries[0];
    expect(e.prevHash).toBe("");
    expect(e.hash).toBe(`h(${("" + e.delta_json).length})`); // sha256(prevHash + delta_json)
    expect(apply).toHaveBeenCalledOnce();
  });

  it("chains prevHash across successive writes", async () => {
    const { mc, ledger } = mk();
    await mc.write({
      entityId: "a",
      entityType: "note",
      action: "insert",
      delta: { x: 1 },
      apply: async () => {},
    });
    await mc.write({
      entityId: "a",
      entityType: "note",
      action: "update",
      delta: { x: 2 },
      apply: async () => {},
    });
    expect(ledger.entries[1].prevHash).toBe(ledger.entries[0].hash);
  });

  it("redacts secrets out of the stored delta before hashing (G-004)", async () => {
    const { mc, ledger } = mk();
    await mc.write({
      entityId: "s",
      entityType: "note",
      action: "update",
      delta: { token: "sk-SECRETSECRETSECRET123456" },
      apply: async () => {},
    });
    expect(ledger.entries[0].delta_json).not.toContain(
      "sk-SECRETSECRETSECRET123456",
    );
  });

  it("emits an ev-<ulid> Event after the write", async () => {
    const { mc, events } = mk();
    await mc.write({
      entityId: "a",
      entityType: "note",
      action: "delete",
      delta: {},
      apply: async () => {},
    });
    expect(events).toHaveLength(1);
    expect(events[0].id).toBe("ev-0000000000000000000000TEST");
    expect(events[0].type).toBe("entity.delete");
  });

  it("applies the write BEFORE recording the ledger (ordering)", async () => {
    const order: string[] = [];
    const ledger = memLedger();
    const origAppend = ledger.append;
    ledger.append = async (e) => {
      order.push("ledger");
      return origAppend(e);
    };
    const { mc } = mk({ ledger });
    await mc.write({
      entityId: "a",
      entityType: "note",
      action: "insert",
      delta: {},
      apply: async () => void order.push("apply"),
    });
    expect(order).toEqual(["apply", "ledger"]);
  });
});
