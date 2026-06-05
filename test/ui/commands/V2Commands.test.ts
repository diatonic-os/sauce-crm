import { describe, expect, it } from "vitest";
import {
  V2_COMMANDS,
  registerV2Commands,
} from "../../../src/ui/commands/V2Commands";

describe("registerV2Commands", () => {
  it("registers every catalogue command with a callback and NO default hotkeys (Obsidian policy)", () => {
    const registered: Array<Record<string, unknown>> = [];
    const handled: string[] = [];
    registerV2Commands({
      addCommand: (cmd) => registered.push(cmd as Record<string, unknown>),
      handler: (id) => {
        handled.push(id);
      },
    });

    expect(registered).toHaveLength(V2_COMMANDS.length);
    expect(registered.map((c) => c.id)).toEqual(V2_COMMANDS.map((c) => c.id));

    // Policy enforced by commit f30ce6a: no command may ship a default hotkey.
    for (const cmd of registered) {
      expect("hotkeys" in cmd).toBe(false);
      expect(typeof cmd.callback).toBe("function");
    }
  });

  it("each registered callback routes back to the handler with its own id", () => {
    const handled: string[] = [];
    const registered: Array<{ id: string; callback: () => void }> = [];
    registerV2Commands({
      addCommand: (cmd) =>
        registered.push(cmd as { id: string; callback: () => void }),
      handler: (id) => {
        handled.push(id);
      },
    });
    for (const cmd of registered) cmd.callback();
    expect(handled).toEqual(V2_COMMANDS.map((c) => c.id));
  });

  it("the command catalogue carries no defaultHotkey data (field removed)", () => {
    for (const c of V2_COMMANDS) {
      expect("defaultHotkey" in c).toBe(false);
    }
  });
});
