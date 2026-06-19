// Tests for the minimal Myers diff + unified-diff format (F2 / CON-SAUCEBOT S2).
// ReDoS-safety: all tests use fixed, literal strings — no constructed patterns.

import { describe, expect, it } from "vitest";
import {
  diffLines,
  createUnifiedDiff,
  formatUnifiedDiff,
  parseUnifiedDiff,
  applyUnifiedDiff,
  applyDiffString,
  DiffParseError,
  DiffApplyError,
} from "../../src/saucebot/tools/diff";

// ---------------------------------------------------------------------------
// diffLines
// ---------------------------------------------------------------------------

describe("diffLines — basic correctness", () => {
  it("returns empty for identical inputs", () => {
    const ops = diffLines(["a", "b", "c"], ["a", "b", "c"]);
    expect(ops.every((o) => o.kind === "equal")).toBe(true);
  });

  it("handles empty original → all inserts", () => {
    const ops = diffLines([], ["x", "y"]);
    expect(ops).toEqual([
      { kind: "insert", value: "x" },
      { kind: "insert", value: "y" },
    ]);
  });

  it("handles empty updated → all deletes", () => {
    const ops = diffLines(["a", "b"], []);
    expect(ops).toEqual([
      { kind: "delete", value: "a" },
      { kind: "delete", value: "b" },
    ]);
  });

  it("handles both empty", () => {
    expect(diffLines([], [])).toEqual([]);
  });

  it("detects a single-line replacement", () => {
    const ops = diffLines(["old"], ["new"]);
    const kinds = ops.map((o) => o.kind);
    expect(kinds).toContain("delete");
    expect(kinds).toContain("insert");
    expect(ops.find((o) => o.kind === "delete")?.value).toBe("old");
    expect(ops.find((o) => o.kind === "insert")?.value).toBe("new");
  });

  it("preserves common prefix and suffix", () => {
    const ops = diffLines(["A", "old", "Z"], ["A", "new", "Z"]);
    const values = ops.map((o) => `${o.kind}:${o.value}`);
    expect(values).toContain("equal:A");
    expect(values).toContain("equal:Z");
    expect(values).toContain("delete:old");
    expect(values).toContain("insert:new");
  });
});

// ---------------------------------------------------------------------------
// createUnifiedDiff + formatUnifiedDiff
// ---------------------------------------------------------------------------

describe("createUnifiedDiff", () => {
  it("returns null for identical texts", () => {
    expect(createUnifiedDiff("same\n", "same\n")).toBeNull();
  });

  it("produces a diff with --- and +++ headers", () => {
    const d = createUnifiedDiff("line1\nold\nline3\n", "line1\nnew\nline3\n");
    expect(d).not.toBeNull();
    const text = formatUnifiedDiff(d!);
    expect(text).toContain("---");
    expect(text).toContain("+++");
    expect(text).toContain("@@");
  });

  it("includes context lines around changes", () => {
    const original = Array.from({ length: 10 }, (_, i) => `line${i}`).join(
      "\n",
    );
    const updated = original.replace("line5", "changed5");
    const d = createUnifiedDiff(original, updated);
    expect(d).not.toBeNull();
    const text = formatUnifiedDiff(d!);
    // Context lines (unchanged) appear with a leading space.
    expect(text).toContain(" line4");
    expect(text).toContain(" line6");
    // The change itself:
    expect(text).toContain("-line5");
    expect(text).toContain("+changed5");
  });
});

// ---------------------------------------------------------------------------
// parseUnifiedDiff
// ---------------------------------------------------------------------------

describe("parseUnifiedDiff", () => {
  it("throws DiffParseError on missing --- header", () => {
    expect(() => parseUnifiedDiff("+++ b/foo.md\n")).toThrow(DiffParseError);
  });

  it("throws DiffParseError on missing +++ header", () => {
    expect(() => parseUnifiedDiff("--- a/foo.md\n")).toThrow(DiffParseError);
  });

  it("parses a minimal valid diff", () => {
    const text = [
      "--- a/note.md",
      "+++ b/note.md",
      "@@ -1,2 +1,2 @@",
      " context",
      "-old",
      "+new",
    ].join("\n");
    const diff = parseUnifiedDiff(text);
    expect(diff.fromFile).toBe("a/note.md");
    expect(diff.toFile).toBe("b/note.md");
    expect(diff.hunks).toHaveLength(1);
    const h = diff.hunks[0];
    expect(h.fromStart).toBe(1);
    expect(h.toStart).toBe(1);
    expect(h.lines).toContain("-old");
    expect(h.lines).toContain("+new");
  });
});

// ---------------------------------------------------------------------------
// applyUnifiedDiff / round-trip
// ---------------------------------------------------------------------------

describe("applyUnifiedDiff — round-trip", () => {
  function roundTrip(original: string, updated: string) {
    const diff = createUnifiedDiff(original, updated);
    if (!diff) return original; // no changes
    return applyUnifiedDiff(original, diff);
  }

  it("round-trips a single-line change", () => {
    const orig = "line1\nold\nline3\n";
    const upd = "line1\nnew\nline3\n";
    expect(roundTrip(orig, upd)).toBe(upd);
  });

  it("round-trips an insertion", () => {
    const orig = "a\nb\n";
    const upd = "a\nINSERTED\nb\n";
    expect(roundTrip(orig, upd)).toBe(upd);
  });

  it("round-trips a deletion", () => {
    const orig = "a\nDELETE_ME\nb\n";
    const upd = "a\nb\n";
    expect(roundTrip(orig, upd)).toBe(upd);
  });

  it("round-trips a multi-hunk diff", () => {
    const orig = Array.from({ length: 20 }, (_, i) => `line${i}`).join("\n");
    const lines = orig.split("\n");
    lines[2] = "changed2";
    lines[15] = "changed15";
    const upd = lines.join("\n");
    expect(roundTrip(orig, upd)).toBe(upd);
  });

  it("is idempotent: applying the same diff twice fails on the second apply", () => {
    const orig = "line1\nold\nline3\n";
    const upd = "line1\nnew\nline3\n";
    const diff = createUnifiedDiff(orig, upd)!;
    const patched = applyUnifiedDiff(orig, diff);
    expect(patched).toBe(upd);
    // Second apply: the "-old" line is gone, so context mismatch → error.
    expect(() => applyUnifiedDiff(patched, diff)).toThrow(DiffApplyError);
  });
});

// ---------------------------------------------------------------------------
// applyDiffString (convenience wrapper)
// ---------------------------------------------------------------------------

describe("applyDiffString", () => {
  it("applies a formatted diff string to original text", () => {
    const original = "hello\nworld\n";
    const updated = "hello\nearth\n";
    const diff = createUnifiedDiff(original, updated)!;
    const text = formatUnifiedDiff(diff);
    expect(applyDiffString(original, text)).toBe(updated);
  });

  it("throws DiffParseError on garbage input", () => {
    expect(() => applyDiffString("original", "not a diff at all")).toThrow(
      DiffParseError,
    );
  });
});
