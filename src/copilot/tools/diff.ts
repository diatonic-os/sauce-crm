/**
 * Minimal unified-diff implementation (F2 / CON-SAUCEBOT S2).
 * - Pure TypeScript, no npm dependency.
 * - ReDoS-safe: no dynamic regex, only literal string operations.
 * - Produces and parses the "@@" hunk format understood by patch(1) / git apply.
 */

// ---------------------------------------------------------------------------
// Myers LCS / diff
// ---------------------------------------------------------------------------

/** A single edit operation in a diff. */
export type DiffOp =
  | { kind: "equal"; value: string }
  | { kind: "delete"; value: string }
  | { kind: "insert"; value: string };

/**
 * Compute the shortest-edit-script between `a` and `b` (arrays of lines).
 *
 * Uses the Wagner-Fischer LCS O(NM) algorithm.  For typical note sizes
 * (< 1000 lines) this is fast enough and is far simpler to get correct than
 * Myers.  Output: a flat list of DiffOps (equal / delete / insert).
 */
export function diffLines(a: string[], b: string[]): DiffOp[] {
  const n = a.length;
  const m = b.length;
  if (n === 0 && m === 0) return [];
  if (n === 0) return b.map((v) => ({ kind: "insert", value: v }));
  if (m === 0) return a.map((v) => ({ kind: "delete", value: v }));

  // dp[i][j] = LCS length for a[0..i-1] vs b[0..j-1].
  // To save memory we only keep two rows.
  // But we also need the full table for backtracking — build it fully.
  // For notes < 2000 lines each this is ~4 MB which is fine.
  const dp: number[][] = Array.from({ length: n + 1 }, () =>
    new Array<number>(m + 1).fill(0),
  );

  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  // Backtrack from (n, m) to (0, 0) — build ops in reverse.
  const opsRev: DiffOp[] = [];
  let i = n;
  let j = m;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && a[i - 1] === b[j - 1]) {
      opsRev.push({ kind: "equal", value: a[i - 1] });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      opsRev.push({ kind: "insert", value: b[j - 1] });
      j--;
    } else {
      opsRev.push({ kind: "delete", value: a[i - 1] });
      i--;
    }
  }
  opsRev.reverse();
  return opsRev;
}

// ---------------------------------------------------------------------------
// Unified diff format
// ---------------------------------------------------------------------------

export interface UnifiedDiff {
  /** Original file label (e.g. "a/path/to/note.md"). */
  fromFile: string;
  /** New file label (e.g. "b/path/to/note.md"). */
  toFile: string;
  hunks: DiffHunk[];
}

export interface DiffHunk {
  /** 1-based starting line in the original file. */
  fromStart: number;
  fromCount: number;
  /** 1-based starting line in the new file. */
  toStart: number;
  toCount: number;
  /** Each string already prefixed with " ", "-", or "+". */
  lines: string[];
}

const CONTEXT = 3; // lines of context around each change

/**
 * Produce a unified diff between `original` and `updated` text.
 * Returns null when the two are identical (no diff needed).
 */
export function createUnifiedDiff(
  original: string,
  updated: string,
  fromLabel = "a/note.md",
  toLabel = "b/note.md",
): UnifiedDiff | null {
  if (original === updated) return null;
  const aLines = original.split("\n");
  const bLines = updated.split("\n");
  const ops = diffLines(aLines, bLines);

  // Build a flat annotation: for each op index, record the line value and kind.
  type Ann = { kind: "equal" | "delete" | "insert"; value: string };
  const ann: Ann[] = [];
  for (const op of ops) {
    ann.push({ kind: op.kind, value: op.value });
  }

  // Group ops into hunks with CONTEXT lines around changed regions.
  const hunks: DiffHunk[] = [];
  let i = 0;

  // Walk through ops, collecting hunks.
  // We track (aLine, bLine) as 1-based counters.
  // Build index: for each ann entry, the a-line and b-line it corresponds to.
  let ai = 1;
  let bi = 1;
  const coords: { a: number; b: number }[] = [];
  for (const a of ann) {
    if (a.kind === "delete") {
      coords.push({ a: ai, b: bi });
      ai++;
    } else if (a.kind === "insert") {
      coords.push({ a: ai, b: bi });
      bi++;
    } else {
      coords.push({ a: ai, b: bi });
      ai++;
      bi++;
    }
  }

  while (i < ann.length) {
    // Skip until we hit a change.
    if (ann[i].kind === "equal") {
      i++;
      continue;
    }
    // Found a change at i. Collect the hunk.
    const start = Math.max(0, i - CONTEXT);
    // Find the end of the changed region.
    let end = i;
    while (end < ann.length && ann[end].kind !== "equal") end++;
    // Extend end by CONTEXT equal lines.
    end = Math.min(ann.length, end + CONTEXT);
    // Merge with any nearby subsequent hunk: advance i to end and look for more
    // changes within CONTEXT*2 equal lines; if found, extend end to include them.
    let j = end;
    while (j < ann.length) {
      if (ann[j].kind !== "equal") {
        // Another change within reach — extend this hunk.
        end = Math.min(ann.length, j + 1);
        // find end of this sub-change
        while (end < ann.length && ann[end].kind !== "equal") end++;
        end = Math.min(ann.length, end + CONTEXT);
        j = end;
      } else if (j < end) {
        j++;
      } else {
        break;
      }
    }

    // Build the hunk lines.
    const slice = ann.slice(start, end);
    const fromStart = coords[start]?.a ?? 1;
    const toStart = coords[start]?.b ?? 1;
    let fromCount = 0;
    let toCount = 0;
    const lines: string[] = [];
    for (const a of slice) {
      if (a.kind === "equal") {
        lines.push(" " + a.value);
        fromCount++;
        toCount++;
      } else if (a.kind === "delete") {
        lines.push("-" + a.value);
        fromCount++;
      } else {
        lines.push("+" + a.value);
        toCount++;
      }
    }
    hunks.push({ fromStart, fromCount, toStart, toCount, lines });
    i = end;
  }

  if (hunks.length === 0) return null;
  return { fromFile: fromLabel, toFile: toLabel, hunks };
}

/**
 * Render a `UnifiedDiff` to a string (the standard text format).
 */
export function formatUnifiedDiff(diff: UnifiedDiff): string {
  const header = `--- ${diff.fromFile}\n+++ ${diff.toFile}\n`;
  const body = diff.hunks
    .map(
      (h) =>
        `@@ -${h.fromStart},${h.fromCount} +${h.toStart},${h.toCount} @@\n` +
        h.lines.join("\n"),
    )
    .join("\n");
  return header + body;
}

/**
 * Parse a unified-diff string into a `UnifiedDiff`.
 * Accepts the standard `--- / +++ / @@ ... @@` format.
 * Throws `DiffParseError` on malformed input.
 */
export class DiffParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DiffParseError";
  }
}

export function parseUnifiedDiff(text: string): UnifiedDiff {
  const lines = text.split("\n");
  let idx = 0;

  const peek = () => lines[idx] ?? "";
  const next = () => lines[idx++] ?? "";

  // Skip leading blank lines / comments.
  while (idx < lines.length && !peek().startsWith("---")) idx++;

  if (!peek().startsWith("---")) throw new DiffParseError("Missing --- header");
  const fromFile = next().slice(4).trim();
  if (!peek().startsWith("+++")) throw new DiffParseError("Missing +++ header");
  const toFile = next().slice(4).trim();

  const hunks: DiffHunk[] = [];

  while (idx < lines.length) {
    const line = peek();
    if (!line.startsWith("@@")) {
      idx++;
      continue;
    }
    // Parse @@ -fromStart,fromCount +toStart,toCount @@ ...
    // Format: @@ -A,B +C,D @@ (no dynamic regex — use indexOf + parseInt)
    const atLine = next();
    const parsed = parseHunkHeader(atLine);
    if (!parsed) throw new DiffParseError(`Malformed hunk header: ${atLine}`);
    const { fromStart, fromCount, toStart, toCount } = parsed;
    const hunkLines: string[] = [];
    let fc = 0;
    let tc = 0;
    while (idx < lines.length) {
      const l = peek();
      if (l.startsWith("@@") || l.startsWith("---") || l.startsWith("+++"))
        break;
      const ch = l[0] ?? " ";
      if (ch === " ") {
        hunkLines.push(l);
        fc++;
        tc++;
      } else if (ch === "-") {
        hunkLines.push(l);
        fc++;
      } else if (ch === "+") {
        hunkLines.push(l);
        tc++;
      } else if (ch === "\\") {
        // "\ No newline at end of file" — skip
      }
      idx++;
      if (fc >= fromCount && tc >= toCount) break;
    }
    hunks.push({ fromStart, fromCount, toStart, toCount, lines: hunkLines });
  }

  return { fromFile, toFile, hunks };
}

function parseHunkHeader(line: string): {
  fromStart: number;
  fromCount: number;
  toStart: number;
  toCount: number;
} | null {
  // @@ -A,B +C,D @@
  const afterAt = line.indexOf("-");
  if (afterAt < 0) return null;
  const spaceAfterFrom = line.indexOf(" ", afterAt);
  if (spaceAfterFrom < 0) return null;
  const fromPart = line.slice(afterAt + 1, spaceAfterFrom); // "A,B"
  const plusIdx = line.indexOf("+", spaceAfterFrom);
  if (plusIdx < 0) return null;
  const spaceAfterTo = line.indexOf(" ", plusIdx);
  const toPart =
    spaceAfterTo < 0
      ? line.slice(plusIdx + 1)
      : line.slice(plusIdx + 1, spaceAfterTo);
  const [fromStart, fromCount] = parseRange(fromPart);
  const [toStart, toCount] = parseRange(toPart);
  return { fromStart, fromCount, toStart, toCount };
}

function parseRange(s: string): [number, number] {
  const comma = s.indexOf(",");
  if (comma < 0) return [parseInt(s, 10), 1];
  return [parseInt(s.slice(0, comma), 10), parseInt(s.slice(comma + 1), 10)];
}

/**
 * Apply a parsed `UnifiedDiff` to `original` text, returning the patched text.
 * Throws `DiffApplyError` when the diff does not apply cleanly.
 */
export class DiffApplyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DiffApplyError";
  }
}

export function applyUnifiedDiff(original: string, diff: UnifiedDiff): string {
  const origLines = original.split("\n");
  const out: string[] = [];
  let srcIdx = 0; // 0-based index into origLines

  for (const hunk of diff.hunks) {
    const hunkFrom = hunk.fromStart - 1; // convert to 0-based
    // Copy unchanged lines up to this hunk.
    while (srcIdx < hunkFrom) {
      if (srcIdx >= origLines.length)
        throw new DiffApplyError(
          `Hunk starts at line ${hunk.fromStart} but original has only ${origLines.length} lines`,
        );
      out.push(origLines[srcIdx++]);
    }
    // Apply the hunk lines.
    for (const l of hunk.lines) {
      const ch = l[0] ?? " ";
      const content = l.slice(1);
      if (ch === " ") {
        // Context line — must match.
        if (srcIdx >= origLines.length || origLines[srcIdx] !== content) {
          throw new DiffApplyError(
            `Context mismatch at line ${srcIdx + 1}: expected ${JSON.stringify(content)}, got ${JSON.stringify(origLines[srcIdx])}`,
          );
        }
        out.push(content);
        srcIdx++;
      } else if (ch === "-") {
        // Delete line — must match.
        if (srcIdx >= origLines.length || origLines[srcIdx] !== content) {
          throw new DiffApplyError(
            `Delete mismatch at line ${srcIdx + 1}: expected ${JSON.stringify(content)}, got ${JSON.stringify(origLines[srcIdx])}`,
          );
        }
        srcIdx++; // consume without emitting
      } else if (ch === "+") {
        // Insert line — emit without consuming source.
        out.push(content);
      }
    }
  }
  // Copy any remaining lines after the last hunk.
  while (srcIdx < origLines.length) {
    out.push(origLines[srcIdx++]);
  }
  return out.join("\n");
}

/**
 * Apply a unified diff string to original text.
 * Convenience wrapper: parse then apply.
 */
export function applyDiffString(original: string, diffText: string): string {
  const diff = parseUnifiedDiff(diffText);
  return applyUnifiedDiff(original, diff);
}
