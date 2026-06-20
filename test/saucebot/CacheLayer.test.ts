// ─────────────────────────────────────────────────────────────────────────────
//  CacheLayer tests — SAUCEOM_HARNESS_DIRECTIVE @providers caching rule
// ─────────────────────────────────────────────────────────────────────────────
//
//  Verifies:
//    • blockKey is key-order independent (canonical serialization)
//    • stablePrefixLength detects shared leading blocks, stops at first divergence
//    • cacheKey is stable + sequence-order sensitive
//    • PrefixCache get/set/size semantics
//    • toToonTransport returns a non-empty TOON string

import { describe, expect, it, beforeEach } from "vitest";
import {
  blockKey,
  stablePrefixLength,
  cacheKey,
  toToonTransport,
  PrefixCache,
  type ContextBlock,
} from "../../src/saucebot/harness/CacheLayer";

// ── helpers ──────────────────────────────────────────────────────────────────

const sys = (content: unknown): ContextBlock => ({ role: "system", content });
const user = (content: unknown): ContextBlock => ({ role: "user", content });
const asst = (content: unknown): ContextBlock => ({ role: "assistant", content });

// ── blockKey ─────────────────────────────────────────────────────────────────

describe("blockKey", () => {
  it("produces a non-empty hex string", () => {
    const k = blockKey(user("hello"));
    expect(k).toMatch(/^[0-9a-f]+$/);
    expect(k.length).toBeGreaterThan(0);
  });

  it("is identical for key-reordered content objects", () => {
    const a: ContextBlock = { role: "user", content: { b: 2, a: 1 } };
    const b: ContextBlock = { role: "user", content: { a: 1, b: 2 } };
    expect(blockKey(a)).toBe(blockKey(b));
  });

  it("differs when role differs", () => {
    expect(blockKey(sys("x"))).not.toBe(blockKey(user("x")));
  });

  it("differs when content differs", () => {
    expect(blockKey(user("hello"))).not.toBe(blockKey(user("world")));
  });

  it("is stable across calls (deterministic)", () => {
    const blk = user({ text: "stable?" });
    expect(blockKey(blk)).toBe(blockKey(blk));
  });
});

// ── stablePrefixLength ───────────────────────────────────────────────────────

describe("stablePrefixLength", () => {
  it("returns 0 when sequences share no leading blocks", () => {
    const prev = [user("A"), asst("B")];
    const next = [user("X"), asst("Y")];
    expect(stablePrefixLength(prev, next)).toBe(0);
  });

  it("returns the length of a fully shared prefix", () => {
    const shared = [sys("setup"), user("hello")];
    const prev = [...shared, asst("reply1")];
    const next = [...shared, asst("reply2")];
    expect(stablePrefixLength(prev, next)).toBe(2);
  });

  it("stops at the first divergence", () => {
    const prev = [sys("setup"), user("A"), asst("B")];
    const next = [sys("setup"), user("Z"), asst("B")];
    expect(stablePrefixLength(prev, next)).toBe(1);
  });

  it("returns min-length when next is a prefix of prev", () => {
    const prev = [sys("s"), user("u"), asst("a")];
    const next = [sys("s"), user("u")];
    expect(stablePrefixLength(prev, next)).toBe(2);
  });

  it("returns 0 for two empty sequences", () => {
    expect(stablePrefixLength([], [])).toBe(0);
  });

  it("handles key-reordered content as a match", () => {
    const blockA: ContextBlock = { role: "user", content: { a: 1, b: 2 } };
    const blockB: ContextBlock = { role: "user", content: { b: 2, a: 1 } };
    expect(stablePrefixLength([blockA], [blockB])).toBe(1);
  });
});

// ── cacheKey ─────────────────────────────────────────────────────────────────

describe("cacheKey", () => {
  it("returns a non-empty hex string", () => {
    const k = cacheKey([sys("s"), user("u")]);
    expect(k).toMatch(/^[0-9a-f]+$/);
  });

  it("is stable (same input ⇒ same key)", () => {
    const blocks = [sys("s"), user("u"), asst("a")];
    expect(cacheKey(blocks)).toBe(cacheKey(blocks));
  });

  it("is order-sensitive — swapping blocks changes the key", () => {
    const blocks1 = [sys("s"), user("u")];
    const blocks2 = [user("u"), sys("s")];
    expect(cacheKey(blocks1)).not.toBe(cacheKey(blocks2));
  });

  it("differs when a block is added", () => {
    const base = [sys("s"), user("u")];
    const extended = [...base, asst("a")];
    expect(cacheKey(base)).not.toBe(cacheKey(extended));
  });

  it("returns the same key for sequences with key-reordered content", () => {
    const a: ContextBlock[] = [{ role: "user", content: { x: 1, y: 2 } }];
    const b: ContextBlock[] = [{ role: "user", content: { y: 2, x: 1 } }];
    expect(cacheKey(a)).toBe(cacheKey(b));
  });
});

// ── PrefixCache ───────────────────────────────────────────────────────────────

describe("PrefixCache", () => {
  let cache: PrefixCache<string>;

  beforeEach(() => {
    cache = new PrefixCache<string>();
  });

  it("starts empty — size() = 0, get() = undefined", () => {
    expect(cache.size()).toBe(0);
    expect(cache.get([user("x")])).toBeUndefined();
  });

  it("set then get returns the stored value", () => {
    const blocks = [sys("s"), user("hello")];
    cache.set(blocks, "response-A");
    expect(cache.get(blocks)).toBe("response-A");
    expect(cache.size()).toBe(1);
  });

  it("get with key-reordered content returns the same hit", () => {
    const blockA: ContextBlock = { role: "user", content: { a: 1, b: 2 } };
    const blockB: ContextBlock = { role: "user", content: { b: 2, a: 1 } };
    cache.set([blockA], "hit");
    expect(cache.get([blockB])).toBe("hit");
  });

  it("returns undefined for a different block sequence", () => {
    cache.set([user("A")], "A-response");
    expect(cache.get([user("B")])).toBeUndefined();
  });

  it("size() grows with distinct entries", () => {
    cache.set([user("A")], "rA");
    cache.set([user("B")], "rB");
    expect(cache.size()).toBe(2);
  });

  it("overwrites on same key", () => {
    const blocks = [user("q")];
    cache.set(blocks, "v1");
    cache.set(blocks, "v2");
    expect(cache.get(blocks)).toBe("v2");
    expect(cache.size()).toBe(1);
  });
});

// ── toToonTransport ───────────────────────────────────────────────────────────

describe("toToonTransport", () => {
  it("returns a non-empty string", () => {
    const result = toToonTransport([sys("You are helpful."), user("Hello!")]);
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
  });

  it("contains role labels from the blocks", () => {
    const result = toToonTransport([sys("setup"), user("query")]);
    expect(result).toContain("system");
    expect(result).toContain("user");
  });

  it("handles a single block", () => {
    const result = toToonTransport([user("solo")]);
    expect(result.length).toBeGreaterThan(0);
  });

  it("handles an empty sequence without throwing", () => {
    expect(() => toToonTransport([])).not.toThrow();
  });
});
