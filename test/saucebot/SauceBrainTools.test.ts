// ─────────────────────────────────────────────────────────────────────────────
//  SAUCE BRAIN / SAUCE OM TOOLSET — concrete ToolDef wiring
// ─────────────────────────────────────────────────────────────────────────────
//
//  Per SAUCEOM_HARNESS_DIRECTIVE v0.1 @brain_tools:
//    ToolDef objects are pure data; service interactions INJECTED.
//    Testable without Obsidian / lancedb / side effects.

import { describe, it, expect, vi } from "vitest";
import {
  buildSauceBrainTools,
  type BrainToolDeps,
} from "../../src/saucebot/harness/SauceBrainTools";

describe("SauceBrainTools", () => {
  describe("buildSauceBrainTools", () => {
    it("returns exactly 4 tools with correct names", () => {
      const deps: BrainToolDeps = {
        recallMemory: vi.fn(),
        rememberFact: vi.fn(),
        searchVault: vi.fn(),
        readNote: vi.fn(),
      };

      const tools = buildSauceBrainTools(deps);

      expect(tools).toHaveLength(4);
      expect(tools.map((t) => t.name)).toEqual([
        "sauce_brain.recall",
        "sauce_brain.remember",
        "sauce_om.search",
        "fs.read",
      ]);
    });

    it("sauce_brain.recall invokes recallMemory with query param", async () => {
      const recallMemory = vi.fn().mockResolvedValue([{ fact: "test" }]);
      const deps: BrainToolDeps = {
        recallMemory,
        rememberFact: vi.fn(),
        searchVault: vi.fn(),
        readNote: vi.fn(),
      };

      const tools = buildSauceBrainTools(deps);
      const recallTool = tools.find((t) => t.name === "sauce_brain.recall")!;

      const result = await recallTool.handler({ query: "what is sauce?" });

      expect(recallMemory).toHaveBeenCalledWith("what is sauce?");
      expect(result).toEqual([{ fact: "test" }]);
    });

    it("sauce_brain.recall coerces input to string and defaults to empty", async () => {
      const recallMemory = vi.fn().mockResolvedValue([]);
      const deps: BrainToolDeps = {
        recallMemory,
        rememberFact: vi.fn(),
        searchVault: vi.fn(),
        readNote: vi.fn(),
      };

      const tools = buildSauceBrainTools(deps);
      const recallTool = tools.find((t) => t.name === "sauce_brain.recall")!;

      await recallTool.handler({});
      expect(recallMemory).toHaveBeenCalledWith("");

      await recallTool.handler({ query: 123 });
      expect(recallMemory).toHaveBeenCalledWith("123");

      await recallTool.handler({ query: null });
      expect(recallMemory).toHaveBeenCalledWith("");
    });

    it("sauce_brain.remember invokes rememberFact with text param", async () => {
      const rememberFact = vi.fn().mockResolvedValue({ id: "fact_1" });
      const deps: BrainToolDeps = {
        recallMemory: vi.fn(),
        rememberFact,
        searchVault: vi.fn(),
        readNote: vi.fn(),
      };

      const tools = buildSauceBrainTools(deps);
      const rememberTool = tools.find((t) => t.name === "sauce_brain.remember")!;

      const result = await rememberTool.handler({ text: "User likes sauce" });

      expect(rememberFact).toHaveBeenCalledWith("User likes sauce");
      expect(result).toEqual({ id: "fact_1" });
    });

    it("sauce_brain.remember coerces input to string and defaults to empty", async () => {
      const rememberFact = vi.fn().mockResolvedValue({});
      const deps: BrainToolDeps = {
        recallMemory: vi.fn(),
        rememberFact,
        searchVault: vi.fn(),
        readNote: vi.fn(),
      };

      const tools = buildSauceBrainTools(deps);
      const rememberTool = tools.find((t) => t.name === "sauce_brain.remember")!;

      await rememberTool.handler({});
      expect(rememberFact).toHaveBeenCalledWith("");

      await rememberTool.handler({ text: 456 });
      expect(rememberFact).toHaveBeenCalledWith("456");

      await rememberTool.handler({ text: undefined });
      expect(rememberFact).toHaveBeenCalledWith("");
    });

    it("sauce_om.search invokes searchVault with query param", async () => {
      const searchVault = vi.fn().mockResolvedValue([{ path: "file.md" }]);
      const deps: BrainToolDeps = {
        recallMemory: vi.fn(),
        rememberFact: vi.fn(),
        searchVault,
        readNote: vi.fn(),
      };

      const tools = buildSauceBrainTools(deps);
      const searchTool = tools.find((t) => t.name === "sauce_om.search")!;

      const result = await searchTool.handler({ query: "feature" });

      expect(searchVault).toHaveBeenCalledWith("feature");
      expect(result).toEqual([{ path: "file.md" }]);
    });

    it("sauce_om.search coerces input to string and defaults to empty", async () => {
      const searchVault = vi.fn().mockResolvedValue([]);
      const deps: BrainToolDeps = {
        recallMemory: vi.fn(),
        rememberFact: vi.fn(),
        searchVault,
        readNote: vi.fn(),
      };

      const tools = buildSauceBrainTools(deps);
      const searchTool = tools.find((t) => t.name === "sauce_om.search")!;

      await searchTool.handler({});
      expect(searchVault).toHaveBeenCalledWith("");

      await searchTool.handler({ query: false });
      expect(searchVault).toHaveBeenCalledWith("");
    });

    it("fs.read invokes readNote with path param", async () => {
      const readNote = vi
        .fn()
        .mockResolvedValue("# File content\n\nBody here");
      const deps: BrainToolDeps = {
        recallMemory: vi.fn(),
        rememberFact: vi.fn(),
        searchVault: vi.fn(),
        readNote,
      };

      const tools = buildSauceBrainTools(deps);
      const readTool = tools.find((t) => t.name === "fs.read")!;

      const result = await readTool.handler({ path: "docs/guide.md" });

      expect(readNote).toHaveBeenCalledWith("docs/guide.md");
      expect(result).toBe("# File content\n\nBody here");
    });

    it("fs.read coerces input to string and defaults to empty", async () => {
      const readNote = vi.fn().mockResolvedValue("");
      const deps: BrainToolDeps = {
        recallMemory: vi.fn(),
        rememberFact: vi.fn(),
        searchVault: vi.fn(),
        readNote,
      };

      const tools = buildSauceBrainTools(deps);
      const readTool = tools.find((t) => t.name === "fs.read")!;

      await readTool.handler({});
      expect(readNote).toHaveBeenCalledWith("");

      await readTool.handler({ path: 42 });
      expect(readNote).toHaveBeenCalledWith("42");

      await readTool.handler({ path: null });
      expect(readNote).toHaveBeenCalledWith("");
    });

    it("all tools have descriptions and input schemas", () => {
      const deps: BrainToolDeps = {
        recallMemory: vi.fn(),
        rememberFact: vi.fn(),
        searchVault: vi.fn(),
        readNote: vi.fn(),
      };

      const tools = buildSauceBrainTools(deps);

      for (const tool of tools) {
        expect(typeof tool.description).toBe("string");
        expect(tool.description.length).toBeGreaterThan(0);
        expect(typeof tool.inputSchema).toBe("object");
        expect(tool.inputSchema).not.toBeNull();
      }
    });

    it("sauce_brain.remember and fs.read are marked dangerous:false", () => {
      const deps: BrainToolDeps = {
        recallMemory: vi.fn(),
        rememberFact: vi.fn(),
        searchVault: vi.fn(),
        readNote: vi.fn(),
      };

      const tools = buildSauceBrainTools(deps);

      const rememberTool = tools.find((t) => t.name === "sauce_brain.remember")!;
      expect(rememberTool.dangerous).toBe(false);

      const readTool = tools.find((t) => t.name === "fs.read")!;
      expect(readTool.dangerous).toBe(false);
    });

    it("handlers never throw on any input shape", async () => {
      const deps: BrainToolDeps = {
        recallMemory: vi.fn().mockResolvedValue([]),
        rememberFact: vi.fn().mockResolvedValue({}),
        searchVault: vi.fn().mockResolvedValue([]),
        readNote: vi.fn().mockResolvedValue(""),
      };

      const tools = buildSauceBrainTools(deps);

      const badInputs = [
        null,
        undefined,
        { extra: "field" },
        { query: [] },
        { text: { nested: "obj" } },
        { path: "" },
      ];

      for (const tool of tools) {
        for (const input of badInputs) {
          expect(async () => {
            await tool.handler(input as Record<string, unknown>);
          }).not.toThrow();
        }
      }
    });
  });
});
