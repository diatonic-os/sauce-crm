import { describe, expect, it, vi } from "vitest";
import { renderIntegrationsSection } from "../../../src/ui/settings/sections/IntegrationsSection";
import { ObsidianPluginRegistry } from "../../../src/integrations/obsidian/ObsidianPluginRegistry";
import type {
  IObsidianPluginIntegration,
  PluginState,
} from "../../../src/integrations/obsidian/IObsidianPluginIntegration";

const FACTS: PluginState = {
  installed: true,
  enabled: true,
  version: "1",
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

function host() {
  const registry = new ObsidianPluginRegistry();
  registry.register(fakeAdapter("dataview", "community"));
  registry.register(fakeAdapter("file-explorer", "core"));
  registry.stateMachine.set("dataview", "OPTIMIZABLE");
  registry.stateMachine.set("file-explorer", "OPTIMIZED");
  return { obsidianPlugins: registry };
}

describe("renderIntegrationsSection — 3-tab grouping", () => {
  it("renders the three tabs: Services | Community Plugins | Core Plugins", () => {
    const root = document.createElement("div");
    renderIntegrationsSection(root, host());
    const tabs = [...root.querySelectorAll(".sauce-tab")].map(
      (t) => t.textContent,
    );
    expect(tabs).toEqual(["Services", "Community Plugins", "Core Plugins"]);
  });

  it("uses tokenized classes only — no inline styles (G-001)", () => {
    const root = document.createElement("div");
    renderIntegrationsSection(root, host());
    expect(root.querySelectorAll("[style]")).toHaveLength(0);
  });

  it("switches to the Community Plugins tab and renders community cards", () => {
    const root = document.createElement("div");
    renderIntegrationsSection(root, host());
    const communityTab = [...root.querySelectorAll(".sauce-tab")].find(
      (t) => t.textContent === "Community Plugins",
    ) as HTMLButtonElement;
    communityTab.click();
    const cards = root.querySelectorAll(".sauce-card");
    expect(cards).toHaveLength(1);
    expect(root.querySelector(".sauce-btn")?.textContent).toBe(
      "Optimize for Sauce",
    );
  });

  it("switches to the Core Plugins tab and renders core cards", () => {
    const root = document.createElement("div");
    renderIntegrationsSection(root, host());
    const coreTab = [...root.querySelectorAll(".sauce-tab")].find(
      (t) => t.textContent === "Core Plugins",
    ) as HTMLButtonElement;
    coreTab.click();
    expect(root.querySelector(".sauce-btn")?.textContent).toBe("Configured ✓");
  });

  it("marks the active tab with aria-selected", () => {
    const root = document.createElement("div");
    renderIntegrationsSection(root, host());
    const tabs = [
      ...root.querySelectorAll(".sauce-tab"),
    ] as HTMLButtonElement[];
    expect(tabs[0].getAttribute("aria-selected")).toBe("true"); // Services default
    tabs[2].click();
    expect(tabs[2].getAttribute("aria-selected")).toBe("true");
    expect(tabs[0].getAttribute("aria-selected")).toBe("false");
  });

  it("fires onPluginAction when a community card button is clicked (Install→Optimize)", async () => {
    const onPluginAction = vi.fn();
    const root = document.createElement("div");
    renderIntegrationsSection(root, { ...host(), onPluginAction });
    const communityTab = [...root.querySelectorAll(".sauce-tab")].find(
      (t) => t.textContent === "Community Plugins",
    ) as HTMLButtonElement;
    communityTab.click();
    (root.querySelector(".sauce-btn") as HTMLButtonElement).click();
    expect(onPluginAction).toHaveBeenCalledWith("dataview", "optimize");
  });
});
