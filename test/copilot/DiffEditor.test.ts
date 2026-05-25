// DiffEditor tests (F2 / CON-SAUCEBOT S2).
// Covers: apply unified diff via a fake process; canon-guard path; idempotency.

import { describe, expect, it, vi } from "vitest";
import { DiffEditor } from "../../src/copilot/tools/DiffEditor";
import { createUnifiedDiff, formatUnifiedDiff } from "../../src/copilot/tools/diff";
import type { VaultProcessHost } from "../../src/copilot/tools/DiffEditor";
import type { FilesService } from "../../src/services/core/FilesService";

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

/** A fake vault store: path → content. */
class FakeVault implements VaultProcessHost {
  private store: Map<string, string>;
  constructor(initial: Record<string, string> = {}) {
    this.store = new Map(Object.entries(initial));
  }
  getAbstractFileByPath(path: string): { path: string } | null {
    return this.store.has(path) ? { path } : null;
  }
  async process(
    file: { path: string },
    fn: (data: string) => string,
  ): Promise<string> {
    const prev = this.store.get(file.path) ?? "";
    const next = fn(prev);
    this.store.set(file.path, next);
    return next;
  }
  async create(path: string, content: string): Promise<{ path: string }> {
    if (this.store.has(path)) throw new Error(`Already exists: ${path}`);
    this.store.set(path, content);
    return { path };
  }
  read(path: string): string | undefined {
    return this.store.get(path);
  }
}

/**
 * Minimal fake FilesService that calls the mutator directly on the in-memory
 * store (non-canonized path).  Tracks whether updateViaContract was called.
 */
function makeFakeFiles(vault: FakeVault, canonized: Set<string> = new Set()): FilesService {
  return {
    async updateViaContract(path: string, mutator: (prev: string) => string): Promise<void> {
      if (canonized.has(path)) {
        // Simulate CanonGuard refusal.
        throw new Error(`CanonGuard: cannot modify canonized file: ${path}`);
      }
      // Simulate normal write.
      await vault.process({ path }, mutator);
    },
    // Unused methods stubbed:
    exists: () => false,
    read: async () => "",
    create: async (p, c) => { await vault.create(p, c); },
    move: async () => {},
    rename: async () => {},
    delete: async () => {},
    trash: async () => {},
    restoreFromHistory: async () => {},
    applyTemplate: async () => {},
    compose: async () => {},
    uniqueNote: async () => "",
  } as unknown as FilesService;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDiff(original: string, updated: string): string {
  const d = createUnifiedDiff(original, updated, "a/note.md", "b/note.md");
  if (!d) throw new Error("no diff (identical)");
  return formatUnifiedDiff(d);
}

// ---------------------------------------------------------------------------
// Tests — apply via fake process
// ---------------------------------------------------------------------------

describe("DiffEditor.applyDiff — fake Vault.process", () => {
  it("applies a unified diff to an existing note", async () => {
    const original = "line1\nold\nline3\n";
    const updated = "line1\nnew\nline3\n";
    const vault = new FakeVault({ "note.md": original });
    const files = makeFakeFiles(vault);
    const editor = new DiffEditor(vault, files);

    const result = await editor.applyDiff("note.md", makeDiff(original, updated));
    expect(result.ok).toBe(true);
    expect(vault.read("note.md")).toBe(updated);
  });

  it("returns ok:false on a malformed diff string", async () => {
    const vault = new FakeVault({ "note.md": "hello\n" });
    const files = makeFakeFiles(vault);
    const editor = new DiffEditor(vault, files);

    const result = await editor.applyDiff("note.md", "this is not a diff");
    expect(result.ok).toBe(false);
    expect((result as { ok: false; error: string }).error).toMatch(/parse/i);
  });

  it("returns ok:false when the diff does not apply cleanly (context mismatch)", async () => {
    const original = "aaa\nbbb\nccc\n";
    const updated = "aaa\nBBB\nccc\n";
    const diffStr = makeDiff(original, updated);

    // Applying to a file with different content → context mismatch.
    const vault = new FakeVault({ "note.md": "xxx\nyyy\nzzz\n" });
    const files = makeFakeFiles(vault);
    const editor = new DiffEditor(vault, files);

    const result = await editor.applyDiff("note.md", diffStr);
    expect(result.ok).toBe(false);
    expect((result as { ok: false; error: string }).error).toMatch(/apply/i);
  });

  it("is idempotent-safe: second apply returns ok:false (context gone)", async () => {
    const original = "a\nold\nb\n";
    const updated = "a\nnew\nb\n";
    const diffStr = makeDiff(original, updated);
    const vault = new FakeVault({ "note.md": original });
    const files = makeFakeFiles(vault);
    const editor = new DiffEditor(vault, files);

    const first = await editor.applyDiff("note.md", diffStr);
    expect(first.ok).toBe(true);
    const second = await editor.applyDiff("note.md", diffStr);
    expect(second.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Tests — canon-guard path
// ---------------------------------------------------------------------------

describe("DiffEditor.applyDiff — CanonGuard", () => {
  it("routes through updateViaContract (not raw vault.process)", async () => {
    const original = "x\nold\ny\n";
    const updated = "x\nnew\ny\n";
    const vault = new FakeVault({ "canon.md": original });
    const files = makeFakeFiles(vault);
    const spy = vi.spyOn(files, "updateViaContract");
    const editor = new DiffEditor(vault, files);

    await editor.applyDiff("canon.md", makeDiff(original, updated));
    expect(spy).toHaveBeenCalledWith("canon.md", expect.any(Function));
  });

  it("returns ok:false when CanonGuard rejects the write", async () => {
    const original = "x\nold\ny\n";
    const updated = "x\nnew\ny\n";
    const vault = new FakeVault({ "canon.md": original });
    // Mark the file as canonized → updateViaContract will throw.
    const files = makeFakeFiles(vault, new Set(["canon.md"]));
    const editor = new DiffEditor(vault, files);

    const result = await editor.applyDiff("canon.md", makeDiff(original, updated));
    expect(result.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Tests — path validation
// ---------------------------------------------------------------------------

describe("DiffEditor — path validation", () => {
  it("rejects paths with '..'", async () => {
    const vault = new FakeVault();
    const files = makeFakeFiles(vault);
    const editor = new DiffEditor(vault, files);
    const result = await editor.applyDiff("../escape.md", "any");
    expect(result.ok).toBe(false);
    expect((result as { ok: false; error: string }).error).toMatch(/\.\./);
  });

  it("rejects paths starting with '/'", async () => {
    const vault = new FakeVault();
    const files = makeFakeFiles(vault);
    const editor = new DiffEditor(vault, files);
    const result = await editor.applyDiff("/absolute/path.md", "any");
    expect(result.ok).toBe(false);
  });

  it("rejects empty path", async () => {
    const vault = new FakeVault();
    const files = makeFakeFiles(vault);
    const editor = new DiffEditor(vault, files);
    const result = await editor.applyDiff("", "any");
    expect(result.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Tests — createNote
// ---------------------------------------------------------------------------

describe("DiffEditor.createNote", () => {
  it("creates a new note via FilesService.create", async () => {
    const vault = new FakeVault();
    const files = makeFakeFiles(vault);
    const editor = new DiffEditor(vault, files);

    const result = await editor.createNote("new/note.md", "# Hello\n");
    expect(result.ok).toBe(true);
    expect(vault.read("new/note.md")).toBe("# Hello\n");
  });

  it("rejects '..' in path", async () => {
    const vault = new FakeVault();
    const files = makeFakeFiles(vault);
    const editor = new DiffEditor(vault, files);

    const result = await editor.createNote("../bad.md", "content");
    expect(result.ok).toBe(false);
  });

  it("returns ok:false when file already exists", async () => {
    const vault = new FakeVault({ "exists.md": "existing" });
    const files = makeFakeFiles(vault);
    const editor = new DiffEditor(vault, files);

    const result = await editor.createNote("exists.md", "new content");
    expect(result.ok).toBe(false);
  });
});
