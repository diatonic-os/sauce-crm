// Vault tool schema + execute contract tests (F2 / CON-SAUCEBOT S2).
// Verifies that each tool satisfies the SkillLike interface and that the
// execute() contract is correct (happy path + error cases).

import { describe, expect, it } from "vitest";
import { makeReadNoteTool } from "../../src/copilot/tools/ReadNoteTool";
import { makeSearchVaultTool } from "../../src/copilot/tools/SearchVaultTool";
import { makeProposeEditTool, makeApplyEditTool } from "../../src/copilot/tools/EditNoteTool";
import { makeCreateNoteTool } from "../../src/copilot/tools/CreateNoteTool";
import { makeWebResearchTool } from "../../src/copilot/tools/WebResearchTool";
import { DiffEditor } from "../../src/copilot/tools/DiffEditor";
import { createUnifiedDiff, formatUnifiedDiff } from "../../src/copilot/tools/diff";
import type { SkillLike } from "../../src/copilot/ToolUseAdapter";
import type { FilesService } from "../../src/services/core/FilesService";

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function assertSkillLike(tool: SkillLike) {
  expect(typeof tool.id).toBe("string");
  expect(tool.id.length).toBeGreaterThan(0);
  expect(Array.isArray(tool.contract.inputs)).toBe(true);
  expect(typeof tool.contract.level).toBe("string");
  expect(typeof tool.execute).toBe("function");
}

// Minimal fake vault + files for DiffEditor.
class FakeVault {
  private store: Map<string, string>;
  constructor(initial: Record<string, string> = {}) {
    this.store = new Map(Object.entries(initial));
  }
  getAbstractFileByPath(path: string): { path: string } | null {
    return this.store.has(path) ? { path } : null;
  }
  async process(file: { path: string }, fn: (d: string) => string): Promise<string> {
    const prev = this.store.get(file.path) ?? "";
    const next = fn(prev);
    this.store.set(file.path, next);
    return next;
  }
  async create(path: string, content: string): Promise<{ path: string }> {
    if (this.store.has(path)) throw new Error("Already exists");
    this.store.set(path, content);
    return { path };
  }
  read(path: string) { return this.store.get(path); }
}

function makeFakeFiles(vault: FakeVault): FilesService {
  return {
    async updateViaContract(path: string, mutator: (prev: string) => string) {
      await vault.process({ path }, mutator);
    },
    async create(p: string, c: string) { await vault.create(p, c); },
  } as unknown as FilesService;
}

// ---------------------------------------------------------------------------
// ReadNoteTool
// ---------------------------------------------------------------------------

describe("ReadNoteTool schema + execute", () => {
  const host = {
    read: async (path: string) =>
      path === "exists.md" ? "# Content\nBody" : null,
  };
  const tool = makeReadNoteTool(host);

  it("satisfies SkillLike", () => assertSkillLike(tool));
  it("id is 'read_note'", () => expect(tool.id).toBe("read_note"));
  it("risk is 'low'", () => expect(tool.risk).toBe("low"));
  it("required input is 'path'", () => {
    const inp = tool.contract.inputs.find((i) => i.name === "path");
    expect(inp?.required).toBe(true);
  });

  it("returns content for an existing note", async () => {
    const r = await tool.execute({ path: "exists.md" }, null);
    expect(r).toEqual({ content: "# Content\nBody" });
  });

  it("returns error for missing note", async () => {
    const r = await tool.execute({ path: "missing.md" }, null);
    expect((r as any).error).toMatch(/not found/i);
  });

  it("returns error for '..' in path", async () => {
    const r = await tool.execute({ path: "../bad.md" }, null);
    expect((r as any).error).toBeTruthy();
  });

  it("returns error for empty path", async () => {
    const r = await tool.execute({ path: "" }, null);
    expect((r as any).error).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// SearchVaultTool
// ---------------------------------------------------------------------------

describe("SearchVaultTool schema + execute", () => {
  const host = {
    search: async (query: string, limit: number) =>
      [{ path: "contacts/Alice.md", score: 0.9, snippet: query }].slice(0, limit),
  };
  const tool = makeSearchVaultTool(host);

  it("satisfies SkillLike", () => assertSkillLike(tool));
  it("id is 'search_vault'", () => expect(tool.id).toBe("search_vault"));
  it("risk is 'low'", () => expect(tool.risk).toBe("low"));

  it("returns results", async () => {
    const r = await tool.execute({ query: "Alice" }, null);
    expect((r as any).results).toHaveLength(1);
    expect((r as any).results[0].path).toBe("contacts/Alice.md");
  });

  it("returns error for empty query", async () => {
    const r = await tool.execute({ query: "" }, null);
    expect((r as any).error).toBeTruthy();
  });

  it("clamps limit to 50", async () => {
    let capturedLimit = 0;
    const h = {
      search: async (_q: string, l: number) => {
        capturedLimit = l;
        return [];
      },
    };
    const t = makeSearchVaultTool(h);
    await t.execute({ query: "x", limit: 9999 }, null);
    expect(capturedLimit).toBe(50);
  });
});

// ---------------------------------------------------------------------------
// ProposeEditTool
// ---------------------------------------------------------------------------

describe("ProposeEditTool schema + execute", () => {
  const host = {
    read: async (path: string) =>
      path === "note.md" ? "line1\nold\nline3\n" : null,
    generateEdit: async (
      _path: string,
      _orig: string,
      _instructions: string,
    ) => "line1\nnew\nline3\n",
    diff: (orig: string, upd: string, label: string) => {
      const d = createUnifiedDiff(orig, upd, `a/${label}`, `b/${label}`);
      return d ? formatUnifiedDiff(d) : null;
    },
  };
  const tool = makeProposeEditTool(host);

  it("satisfies SkillLike", () => assertSkillLike(tool));
  it("id is 'propose_edit'", () => expect(tool.id).toBe("propose_edit"));
  it("risk is 'medium'", () => expect(tool.risk).toBe("medium"));

  it("returns a diff string", async () => {
    const r = await tool.execute({ path: "note.md", instructions: "replace old with new" }, null);
    expect((r as any).diff).toContain("@@");
    expect((r as any).diff).toContain("-old");
    expect((r as any).diff).toContain("+new");
  });

  it("returns error when note not found", async () => {
    const r = await tool.execute({ path: "missing.md", instructions: "foo" }, null);
    expect((r as any).error).toMatch(/not found/i);
  });

  it("returns error when no changes", async () => {
    const noOpHost = {
      ...host,
      generateEdit: async (_p: string, orig: string) => orig,
    };
    const t = makeProposeEditTool(noOpHost);
    const r = await t.execute({ path: "note.md", instructions: "noop" }, null);
    expect((r as any).error).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// ApplyEditTool
// ---------------------------------------------------------------------------

describe("ApplyEditTool schema + execute", () => {
  it("satisfies SkillLike", () => {
    const vault = new FakeVault();
    const files = makeFakeFiles(vault);
    const editor = new DiffEditor(vault, files);
    const tool = makeApplyEditTool(editor);
    assertSkillLike(tool);
  });

  it("id is 'apply_edit' and risk is 'high'", () => {
    const vault = new FakeVault();
    const files = makeFakeFiles(vault);
    const editor = new DiffEditor(vault, files);
    const tool = makeApplyEditTool(editor);
    expect(tool.id).toBe("apply_edit");
    expect(tool.risk).toBe("high");
  });

  it("applies diff and returns ok:true", async () => {
    const original = "line1\nold\nline3\n";
    const updated = "line1\nnew\nline3\n";
    const vault = new FakeVault({ "note.md": original });
    const files = makeFakeFiles(vault);
    const editor = new DiffEditor(vault, files);
    const tool = makeApplyEditTool(editor);
    const diff = createUnifiedDiff(original, updated)!;
    const diffStr = formatUnifiedDiff(diff);
    const r = await tool.execute({ path: "note.md", diff: diffStr }, null);
    expect((r as any).ok).toBe(true);
    expect(vault.read("note.md")).toBe(updated);
  });

  it("returns error for bad diff", async () => {
    const vault = new FakeVault({ "note.md": "content\n" });
    const files = makeFakeFiles(vault);
    const editor = new DiffEditor(vault, files);
    const tool = makeApplyEditTool(editor);
    const r = await tool.execute({ path: "note.md", diff: "garbage" }, null);
    expect((r as any).error).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// CreateNoteTool
// ---------------------------------------------------------------------------

describe("CreateNoteTool schema + execute", () => {
  it("satisfies SkillLike", () => {
    const vault = new FakeVault();
    const files = makeFakeFiles(vault);
    const editor = new DiffEditor(vault, files);
    assertSkillLike(makeCreateNoteTool(editor));
  });

  it("id is 'create_note' and risk is 'high'", () => {
    const vault = new FakeVault();
    const files = makeFakeFiles(vault);
    const editor = new DiffEditor(vault, files);
    const tool = makeCreateNoteTool(editor);
    expect(tool.id).toBe("create_note");
    expect(tool.risk).toBe("high");
  });

  it("creates a new note", async () => {
    const vault = new FakeVault();
    const files = makeFakeFiles(vault);
    const editor = new DiffEditor(vault, files);
    const tool = makeCreateNoteTool(editor);
    const r = await tool.execute({ path: "new.md", content: "# New\n" }, null);
    expect((r as any).ok).toBe(true);
    expect(vault.read("new.md")).toBe("# New\n");
  });

  it("returns error for '..' in path", async () => {
    const vault = new FakeVault();
    const files = makeFakeFiles(vault);
    const editor = new DiffEditor(vault, files);
    const tool = makeCreateNoteTool(editor);
    const r = await tool.execute({ path: "../../bad.md", content: "" }, null);
    expect((r as any).error).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// WebResearchTool
// ---------------------------------------------------------------------------

describe("WebResearchTool schema + execute", () => {
  it("satisfies SkillLike", () => {
    const host = { fetch: async (_url: string) => "" };
    assertSkillLike(makeWebResearchTool(host));
  });

  it("id is 'web_research' and risk is 'medium'", () => {
    const tool = makeWebResearchTool({ fetch: async () => "" });
    expect(tool.id).toBe("web_research");
    expect(tool.risk).toBe("medium");
  });

  it("fetches a URL directly when it starts with https://", async () => {
    let capturedUrl = "";
    const host = {
      fetch: async (url: string) => {
        capturedUrl = url;
        return "page content";
      },
    };
    const tool = makeWebResearchTool(host);
    const r = await tool.execute({ url_or_query: "https://example.com" }, null);
    expect(capturedUrl).toBe("https://example.com");
    expect((r as any).content).toBe("page content");
  });

  it("converts a plain query to a DuckDuckGo URL", async () => {
    let capturedUrl = "";
    const host = {
      fetch: async (url: string) => {
        capturedUrl = url;
        return "search results";
      },
    };
    const tool = makeWebResearchTool(host);
    await tool.execute({ url_or_query: "hello world" }, null);
    expect(capturedUrl).toContain("duckduckgo.com");
    expect(capturedUrl).toContain("hello");
  });

  it("truncates content to 8000 chars", async () => {
    const big = "x".repeat(10000);
    const tool = makeWebResearchTool({ fetch: async () => big });
    const r = await tool.execute({ url_or_query: "https://big.com" }, null);
    expect((r as any).content.length).toBe(8000);
  });

  it("returns error on network failure", async () => {
    const tool = makeWebResearchTool({
      fetch: async () => { throw new Error("ECONNREFUSED"); },
    });
    const r = await tool.execute({ url_or_query: "https://down.example.com" }, null);
    expect((r as any).error).toMatch(/network/i);
  });

  it("returns error for empty url_or_query", async () => {
    const tool = makeWebResearchTool({ fetch: async () => "" });
    const r = await tool.execute({ url_or_query: "" }, null);
    expect((r as any).error).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// ToolUseAdapter.register — all tools wire cleanly
// ---------------------------------------------------------------------------

import { ToolUseAdapter } from "../../src/copilot/ToolUseAdapter";
import { VaultContextProvider } from "../../src/copilot/VaultContextProvider";
import { registerVaultTools } from "../../src/copilot/tools";

describe("registerVaultTools — all 7 tools land on the adapter", () => {
  it("registers read_note, search_vault, propose_edit, apply_edit, create_note, web_research, get_links", () => {
    const vault = new FakeVault({ "existing.md": "content\n" });
    const files = makeFakeFiles(vault);
    const linkProvider = new VaultContextProvider({ resolvedLinks: {} });
    linkProvider.rebuild();
    const adapter = new ToolUseAdapter();

    registerVaultTools(adapter, {
      vaultHost: vault,
      files,
      readHost: { read: async (p) => vault.read(p) ?? null },
      searchHost: { search: async (_q, _l) => [] },
      editHost: {
        read: async (p) => vault.read(p) ?? null,
        generateEdit: async (_p, orig, _i) => orig,
        diff: (orig, upd, label) => {
          const d = createUnifiedDiff(orig, upd, `a/${label}`, `b/${label}`);
          return d ? formatUnifiedDiff(d) : null;
        },
      },
      webHost: { fetch: async () => "" },
      linkProvider,
    });

    const expected = [
      "read_note",
      "search_vault",
      "propose_edit",
      "apply_edit",
      "create_note",
      "web_research",
      "get_links",
    ];
    for (const id of expected) {
      expect(adapter.has(id), `adapter should have tool '${id}'`).toBe(true);
    }
  });

  it("asTools() includes all 7 tool names", () => {
    const vault = new FakeVault();
    const files = makeFakeFiles(vault);
    const linkProvider = new VaultContextProvider({ resolvedLinks: {} });
    const adapter = new ToolUseAdapter();

    registerVaultTools(adapter, {
      vaultHost: vault,
      files,
      readHost: { read: async () => null },
      searchHost: { search: async () => [] },
      editHost: {
        read: async () => null,
        generateEdit: async (_p, orig) => orig,
        diff: () => null,
      },
      webHost: { fetch: async () => "" },
      linkProvider,
    });

    const names = adapter.asTools().map((t) => t.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "read_note",
        "search_vault",
        "propose_edit",
        "apply_edit",
        "create_note",
        "web_research",
        "get_links",
      ]),
    );
  });
});
