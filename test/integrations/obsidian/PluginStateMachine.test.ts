import { describe, expect, it, vi } from "vitest";
import {
  PluginStateMachine,
  reduce,
  deriveStateFromFacts,
  BUTTON_LABELS,
} from "../../../src/integrations/obsidian/PluginStateMachine";
import type {
  PluginButtonState,
  PluginState,
} from "../../../src/integrations/obsidian/IObsidianPluginIntegration";

// ── reduce(): the pure transition reducer (DEC-001 / S-button) ──────────
describe("reduce (pure S-button reducer)", () => {
  it("walks the documented happy path NOT_INSTALLED → OPTIMIZED", () => {
    let s: PluginButtonState = "NOT_INSTALLED";
    s = reduce(s, "install");
    expect(s).toBe("INSTALLING");
    s = reduce(s, "installed");
    expect(s).toBe("INSTALLED");
    s = reduce(s, "detectUnoptimized");
    expect(s).toBe("OPTIMIZABLE");
    s = reduce(s, "optimize");
    expect(s).toBe("OPTIMIZING");
    s = reduce(s, "applied");
    expect(s).toBe("OPTIMIZED");
  });

  it("INSTALLED + detectOptimized short-circuits to OPTIMIZED", () => {
    expect(reduce("INSTALLED", "detectOptimized")).toBe("OPTIMIZED");
  });

  it("OPTIMIZED + newVersionAvailable → OUTDATED → updateAndOptimize → OPTIMIZING", () => {
    expect(reduce("OPTIMIZED", "newVersionAvailable")).toBe("OUTDATED");
    expect(reduce("OUTDATED", "updateAndOptimize")).toBe("OPTIMIZING");
  });

  it("honors wildcard transitions from ANY state", () => {
    for (const from of [
      "NOT_INSTALLED",
      "OPTIMIZED",
      "OUTDATED",
    ] as PluginButtonState[]) {
      expect(reduce(from, "userDisable")).toBe("DISABLED");
      expect(reduce(from, "versionMismatch")).toBe("INCOMPATIBLE");
      expect(reduce(from, "error")).toBe("ERROR");
    }
  });

  it("DISABLED + userEnable → INSTALLED, ERROR + retry → INSTALLED", () => {
    expect(reduce("DISABLED", "userEnable")).toBe("INSTALLED");
    expect(reduce("ERROR", "retry")).toBe("INSTALLED");
  });

  it("is pure: an illegal (state,event) pair returns the state unchanged", () => {
    expect(reduce("NOT_INSTALLED", "applied")).toBe("NOT_INSTALLED");
    expect(reduce("OPTIMIZED", "retry")).toBe("OPTIMIZED");
  });
});

// ── deriveStateFromFacts(): detect() facts → initial button state ───────
describe("deriveStateFromFacts", () => {
  const base: PluginState = {
    installed: true,
    enabled: true,
    version: "1.0.0",
    optimized: false,
    compatible: true,
  };
  it("maps detection facts to the right button state", () => {
    expect(deriveStateFromFacts({ ...base, installed: false })).toBe(
      "NOT_INSTALLED",
    );
    expect(deriveStateFromFacts({ ...base, compatible: false })).toBe(
      "INCOMPATIBLE",
    );
    expect(deriveStateFromFacts({ ...base, enabled: false })).toBe("DISABLED");
    expect(
      deriveStateFromFacts({ ...base, optimized: true, updateAvailable: true }),
    ).toBe("OUTDATED");
    expect(deriveStateFromFacts({ ...base, optimized: true })).toBe(
      "OPTIMIZED",
    );
    expect(deriveStateFromFacts({ ...base, optimized: false })).toBe(
      "OPTIMIZABLE",
    );
  });
});

// ── S-button-labels map ─────────────────────────────────────────────────
describe("BUTTON_LABELS", () => {
  it("matches the S-button-labels contract table exactly", () => {
    expect(BUTTON_LABELS).toEqual({
      NOT_INSTALLED: "Install",
      INSTALLING: "Installing…",
      INSTALLED: "Detecting…",
      OPTIMIZABLE: "Optimize for Sauce",
      OPTIMIZING: "Optimizing…",
      OPTIMIZED: "Configured ✓",
      OUTDATED: "Update & Re-optimize",
      DISABLED: "Enable",
      INCOMPATIBLE: "Incompatible — check minAppVersion",
      ERROR: "Retry",
    });
  });
});

// ── PluginStateMachine: stateful, emits typed transitions, persists ─────
describe("PluginStateMachine", () => {
  it("emits a typed transition only when the state changes", () => {
    const sm = new PluginStateMachine();
    const seen: Array<{
      pluginId: string;
      from: PluginButtonState;
      to: PluginButtonState;
    }> = [];
    sm.onTransition((t) =>
      seen.push({ pluginId: t.pluginId, from: t.from, to: t.to }),
    );

    sm.set("obsidian-tasks-plugin", "NOT_INSTALLED");
    sm.dispatch("obsidian-tasks-plugin", "install");
    sm.dispatch("obsidian-tasks-plugin", "applied"); // illegal from INSTALLING → no emit

    expect(sm.get("obsidian-tasks-plugin")).toBe("INSTALLING");
    expect(seen).toEqual([
      {
        pluginId: "obsidian-tasks-plugin",
        from: "NOT_INSTALLED",
        to: "INSTALLING",
      },
    ]);
  });

  it("snapshot() returns the persistable saucecrm.pluginStates record", () => {
    const persist = vi.fn();
    const sm = new PluginStateMachine({ onPersist: persist });
    sm.set("dataview", "OPTIMIZED");
    sm.dispatch("dataview", "newVersionAvailable");
    expect(sm.snapshot()).toEqual({ dataview: "OUTDATED" });
    expect(persist).toHaveBeenLastCalledWith({ dataview: "OUTDATED" });
  });

  it("hydrate() restores a persisted snapshot", () => {
    const sm = new PluginStateMachine();
    sm.hydrate({ quickadd: "DISABLED", dataview: "OPTIMIZED" });
    expect(sm.get("quickadd")).toBe("DISABLED");
    expect(sm.get("dataview")).toBe("OPTIMIZED");
    expect(sm.get("unknown")).toBe("NOT_INSTALLED"); // default for unseen
  });
});
