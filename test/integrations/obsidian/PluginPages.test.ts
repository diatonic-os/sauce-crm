import { describe, expect, it, vi } from "vitest";
import {
  renderCommunityPluginsPage,
  renderPluginCard,
  primaryEventFor,
  type PluginCardContext,
} from "../../../src/ui/settings/integrations/CommunityPluginsPage";
import { renderCorePluginsPage } from "../../../src/ui/settings/integrations/CorePluginsPage";
import { ObsidianPluginRegistry } from "../../../src/integrations/obsidian/ObsidianPluginRegistry";
import type {
  IObsidianPluginIntegration,
  PluginState,
} from "../../../src/integrations/obsidian/IObsidianPluginIntegration";

const FACTS: PluginState = {
  installed: true,
  enabled: true,
  version: "1.0.0",
  optimized: false,
  compatible: true,
};

function fakeAdapter(
  pluginId: string,
  pluginClass: "community" | "core",
): IObsidianPluginIntegration {
  return {
    id: pluginId,
    label: pluginId,
    pluginId,
    pluginClass,
    detect: vi.fn(async () => FACTS),
    optimize: vi.fn(async () => ({ ok: true, applied: [] })),
    getServiceFacade: <T>() => ({}) as T,
    getOptimizationDiff: vi.fn(async () => ({ pluginId, changes: [] })),
    supportsBeta: () => false,
    connect: async () => ({ connected: true }),
    disconnect: async () => {},
    state: async () => ({ connected: true }),
    listResources: async () => [],
    syncResource: async () => ({ pulled: 0, pushed: 0, errors: 0 }),
  };
}

function registryWith(): ObsidianPluginRegistry {
  const reg = new ObsidianPluginRegistry();
  reg.register(fakeAdapter("dataview", "community"));
  reg.register(fakeAdapter("file-explorer", "core"));
  reg.stateMachine.set("dataview", "OPTIMIZABLE");
  reg.stateMachine.set("file-explorer", "OPTIMIZED");
  return reg;
}

describe("primaryEventFor — state → button action", () => {
  it("maps actionable states to their event, inert states to null", () => {
    expect(primaryEventFor("NOT_INSTALLED")).toBe("install");
    expect(primaryEventFor("OPTIMIZABLE")).toBe("optimize");
    expect(primaryEventFor("OUTDATED")).toBe("updateAndOptimize");
    expect(primaryEventFor("DISABLED")).toBe("userEnable");
    expect(primaryEventFor("ERROR")).toBe("retry");
    expect(primaryEventFor("OPTIMIZED")).toBeNull();
    expect(primaryEventFor("INSTALLING")).toBeNull();
    expect(primaryEventFor("INCOMPATIBLE")).toBeNull();
  });
});

describe("renderCommunityPluginsPage", () => {
  it("renders one card per community adapter, button label from BUTTON_LABELS", () => {
    const reg = registryWith();
    const root = document.createElement("div");
    renderCommunityPluginsPage(root, { registry: reg });

    const cards = root.querySelectorAll(".sauce-card");
    expect(cards).toHaveLength(1); // only the community adapter, not the core one
    const btn = root.querySelector(".sauce-btn") as HTMLButtonElement;
    expect(btn.textContent).toBe("Optimize for Sauce");
  });

  it("uses tokenized classes only — no inline styles (G-001)", () => {
    const reg = registryWith();
    const root = document.createElement("div");
    renderCommunityPluginsPage(root, { registry: reg });
    expect(root.querySelectorAll("[style]")).toHaveLength(0);
  });

  it("fires onAction with the state's primary event when the button is clicked", () => {
    const reg = registryWith();
    const onAction = vi.fn();
    const root = document.createElement("div");
    renderCommunityPluginsPage(root, { registry: reg, onAction });
    (root.querySelector(".sauce-btn") as HTMLButtonElement).click();
    expect(onAction).toHaveBeenCalledWith("dataview", "optimize");
  });

  it("disables the button for inert states (OPTIMIZED → Configured ✓)", () => {
    const reg = new ObsidianPluginRegistry();
    reg.register(fakeAdapter("dataview", "community"));
    reg.stateMachine.set("dataview", "OPTIMIZED");
    const root = document.createElement("div");
    renderCommunityPluginsPage(root, { registry: reg });
    const btn = root.querySelector(".sauce-btn") as HTMLButtonElement;
    expect(btn.textContent).toBe("Configured ✓");
    expect(btn.disabled).toBe(true);
  });
});

describe("renderCorePluginsPage", () => {
  it("renders only core adapters", () => {
    const reg = registryWith();
    const root = document.createElement("div");
    renderCorePluginsPage(root, { registry: reg });
    const cards = root.querySelectorAll(".sauce-card");
    expect(cards).toHaveLength(1);
    expect(
      (root.querySelector(".sauce-btn") as HTMLButtonElement).textContent,
    ).toBe("Configured ✓");
  });
});

describe("renderPluginCard — shared builder", () => {
  it("stamps a per-plugin badge and title", () => {
    const reg = registryWith();
    const ctx: PluginCardContext = { registry: reg };
    const grid = document.createElement("div");
    const card = renderPluginCard(grid, reg.get("dataview")!, ctx);
    expect(card.classList.contains("sauce-card")).toBe(true);
    expect(card.querySelector(".sauce-card-title")?.textContent).toBe(
      "dataview",
    );
  });
});
