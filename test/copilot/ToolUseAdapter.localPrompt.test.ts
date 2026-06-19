// ToolUseAdapter.localToolPrompt — the prose tool schema + one-shot example
// injected into a local model's system prompt to lift tool-use reliability.

import { describe, expect, it } from "vitest";
import { ToolUseAdapter } from "../../src/saucebot/ToolUseAdapter";

describe("ToolUseAdapter.localToolPrompt", () => {
  it("returns '' when no tools are registered", () => {
    expect(new ToolUseAdapter().localToolPrompt()).toBe("");
  });

  it("renders each tool with its args, required markers, and a one-shot example", () => {
    const a = new ToolUseAdapter();
    a.register({
      id: "read_note",
      description: "Read a vault note by path",
      contract: {
        inputs: [
          { name: "path", type: "string", description: "vault path", required: true },
          { name: "limit", type: "number", description: "max lines" },
        ],
        level: "safe",
      },
      execute: async () => ({}),
    });
    const p = a.localToolPrompt();
    expect(p).toContain("## Tools available");
    expect(p).toContain("`read_note`: Read a vault note by path");
    expect(p).toContain("path: string (required) — vault path");
    expect(p).toContain("limit: number");
    expect(p).toContain("ONLY the tool call");
    // One-shot example references the first tool by name.
    expect(p).toContain("read_note(");
  });
});
