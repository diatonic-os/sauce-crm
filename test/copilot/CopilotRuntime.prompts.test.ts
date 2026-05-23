// T6 — prompt composition + session management on CopilotRuntime.
import { describe, expect, it } from "vitest";
import { CopilotRuntime, type CopilotSettings } from "../../src/copilot/CopilotRuntime";

function stubs() {
  const app = { vault: {}, metadataCache: {} } as never;
  const entities = {} as never;
  const search = {} as never;
  return { app, entities, search };
}

function rt(): CopilotRuntime {
  const settings: CopilotSettings = {
    provider: "lmstudio", model: "m", apiKey: "", temperature: 0.3, maxTokens: 100,
    systemPrompt: "BASE PROMPT",
  };
  const { app, entities, search } = stubs();
  return new CopilotRuntime(app, entities, search, settings);
}

describe("CopilotRuntime — prompt composition (T6)", () => {
  it("uses the base prompt alone by default", () => {
    expect(rt().composeSystemPrompt()).toBe("BASE PROMPT");
  });

  it("prepends the global prompt ahead of the base", () => {
    const r = rt();
    r.setPromptConfig({ globalSystemPrompt: "GLOBAL", sessionAutoNaming: true });
    expect(r.composeSystemPrompt()).toBe("GLOBAL\n\nBASE PROMPT");
  });

  it("a per-session prompt overrides the base (global still prepended)", () => {
    const r = rt();
    r.setPromptConfig({ globalSystemPrompt: "GLOBAL", sessionAutoNaming: true });
    r.setSessionPrompt("SESSION");
    expect(r.composeSystemPrompt()).toBe("GLOBAL\n\nSESSION");
  });

  it("blank session prompt clears the override", () => {
    const r = rt();
    r.setSessionPrompt("x");
    r.setSessionPrompt("   ");
    expect(r.getSessionPrompt()).toBeNull();
    expect(r.composeSystemPrompt()).toBe("BASE PROMPT");
  });
});

describe("CopilotRuntime — session autonaming (T6)", () => {
  it("derives a title from the first message line when enabled", () => {
    const r = rt();
    r.setPromptConfig({ globalSystemPrompt: "", sessionAutoNaming: true });
    expect(r.sessionTitle("How do I reach Bob?\nmore text")).toBe("How do I reach Bob?");
  });

  it("truncates long first lines", () => {
    const r = rt();
    r.setPromptConfig({ globalSystemPrompt: "", sessionAutoNaming: true });
    const title = r.sessionTitle("x".repeat(100))!;
    expect(title.length).toBe(58); // 57 chars + ellipsis
    expect(title.endsWith("…")).toBe(true);
  });

  it("returns null when autonaming is off", () => {
    const r = rt();
    r.setPromptConfig({ globalSystemPrompt: "", sessionAutoNaming: false });
    expect(r.sessionTitle("anything")).toBeNull();
  });
});
