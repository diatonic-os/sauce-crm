// Unified id layer — stable, non-repeatable, time-sortable, self-describing.

import { describe, expect, it } from "vitest";
import {
  ulid,
  newId,
  newConversationId,
  newTurnId,
  isId,
  fingerprint,
} from "../../src/saucebot/Ids";

describe("ulid", () => {
  it("is 26 chars and time-sortable (later timestamp sorts after earlier)", () => {
    const a = ulid(1000);
    const b = ulid(2000);
    expect(a).toHaveLength(26);
    expect(a < b).toBe(true);
  });

  it("never repeats across many draws (multi-user/install safety)", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 5000; i++) seen.add(ulid(1000)); // same ts → random half differs
    expect(seen.size).toBe(5000);
  });
});

describe("prefixed ids", () => {
  it("are self-describing and validate by kind", () => {
    const cnv = newConversationId();
    expect(cnv.startsWith("cnv_")).toBe(true);
    expect(isId(cnv, "cnv")).toBe(true);
    expect(isId(cnv, "trn")).toBe(false);
    expect(isId(newTurnId(), "trn")).toBe(true);
  });

  it("rejects malformed ids", () => {
    expect(isId("not-an-id")).toBe(false);
    expect(isId("cnv_short")).toBe(false);
    expect(isId(123)).toBe(false);
  });

  it("newId honors the timestamp for sortability", () => {
    expect(newId("trn", 1).slice(4) < newId("trn", 2).slice(4)).toBe(true);
  });
});

describe("fingerprint", () => {
  it("is deterministic for identical content and differs for different content", async () => {
    const a = await fingerprint("hello world");
    const b = await fingerprint("hello world");
    const c = await fingerprint("hello worlx");
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a.length).toBeGreaterThanOrEqual(8);
  });
});
