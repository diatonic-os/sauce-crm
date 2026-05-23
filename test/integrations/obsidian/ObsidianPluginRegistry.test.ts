import { describe, expect, it, vi } from "vitest";
import { ObsidianPluginRegistry } from "../../../src/integrations/obsidian/ObsidianPluginRegistry";
import { PluginStateMachine } from "../../../src/integrations/obsidian/PluginStateMachine";
import type {
  IObsidianPluginIntegration,
  PluginState,
} from "../../../src/integrations/obsidian/IObsidianPluginIntegration";

// A minimal fake adapter — only the members the registry touches.
function fakeAdapter(
  pluginId: string,
  facts: PluginState,
): IObsidianPluginIntegration {
  return {
    id: pluginId,
    label: pluginId,
    pluginId,
    pluginClass: "community",
    detect: vi.fn(async () => facts),
    optimize: vi.fn(async () => ({ ok: true, applied: [] })),
    getServiceFacade: <T>() => ({}) as T,
    getOptimizationDiff: vi.fn(async () => ({ pluginId, changes: [] })),
    supportsBeta: () => false,
    // IIntegration members (unused by the registry, trivially satisfied):
    connect: async () => ({ connected: facts.enabled }),
    disconnect: async () => {},
    state: async () => ({ connected: facts.enabled }),
    listResources: async () => [],
    syncResource: async () => ({ pulled: 0, pushed: 0, errors: 0 }),
  };
}

const INSTALLED_UNOPT: PluginState = {
  installed: true,
  enabled: true,
  version: "1.0.0",
  optimized: false,
  compatible: true,
};

describe("ObsidianPluginRegistry — Map surface", () => {
  it("register/get/list/has/unregister/dispose behave like a registry", () => {
    const reg = new ObsidianPluginRegistry();
    const a = fakeAdapter("dataview", INSTALLED_UNOPT);
    const b = fakeAdapter("quickadd", INSTALLED_UNOPT);

    reg.register(a);
    reg.register(b);
    expect(reg.has("dataview")).toBe(true);
    expect(reg.get("quickadd")).toBe(b);
    expect(
      reg
        .list()
        .map((x) => x.pluginId)
        .sort(),
    ).toEqual(["dataview", "quickadd"]);

    expect(reg.unregister("dataview")).toBe(true);
    expect(reg.has("dataview")).toBe(false);

    reg.dispose();
    expect(reg.list()).toEqual([]);
  });

  it("register replaces an existing adapter for the same id (idempotent)", () => {
    const reg = new ObsidianPluginRegistry();
    const a1 = fakeAdapter("dataview", INSTALLED_UNOPT);
    const a2 = fakeAdapter("dataview", INSTALLED_UNOPT);
    reg.register(a1);
    reg.register(a2);
    expect(reg.list()).toHaveLength(1);
    expect(reg.get("dataview")).toBe(a2);
  });
});

describe("ObsidianPluginRegistry — refresh drives state machine + emits", () => {
  it("detects each adapter, sets derived button state, emits to the sink", async () => {
    const sm = new PluginStateMachine();
    const emit = vi.fn();
    const reg = new ObsidianPluginRegistry({
      sink: { emit },
      stateMachine: sm,
    });
    reg.register(fakeAdapter("dataview", INSTALLED_UNOPT));
    reg.register(
      fakeAdapter("obsidian-tasks-plugin", {
        ...INSTALLED_UNOPT,
        optimized: true,
      }),
    );

    await reg.refresh();

    expect(sm.get("dataview")).toBe("OPTIMIZABLE");
    expect(sm.get("obsidian-tasks-plugin")).toBe("OPTIMIZED");
    // emitted a registry state event keyed off the documented channel
    expect(emit).toHaveBeenCalledWith(
      "obsidian-plugin:state",
      expect.objectContaining({ pluginId: "dataview", state: "OPTIMIZABLE" }),
    );
  });
});

describe("ObsidianPluginRegistry — attach wires Obsidian events", () => {
  it("subscribes to app.plugins 'change' and workspace.onLayoutReady, refreshing on each", async () => {
    const sm = new PluginStateMachine();
    const reg = new ObsidianPluginRegistry({ stateMachine: sm });
    reg.register(fakeAdapter("dataview", INSTALLED_UNOPT));

    let changeCb: (() => void) | null = null;
    let layoutCb: (() => void) | null = null;
    const offChange = vi.fn();
    const app = {
      plugins: {
        on: vi.fn((evt: string, cb: () => void) => {
          if (evt === "change") changeCb = cb;
          return { evt };
        }),
        offref: offChange,
      },
      workspace: {
        onLayoutReady: vi.fn((cb: () => void) => {
          layoutCb = cb;
        }),
      },
    };

    reg.attach(app as never);
    expect(app.workspace.onLayoutReady).toHaveBeenCalled();
    expect(app.plugins.on).toHaveBeenCalledWith("change", expect.any(Function));

    // fire the layout-ready + change callbacks → state populated
    await layoutCb?.();
    expect(sm.get("dataview")).toBe("OPTIMIZABLE");

    sm.set("dataview", "NOT_INSTALLED"); // perturb
    await changeCb?.();
    expect(sm.get("dataview")).toBe("OPTIMIZABLE"); // refresh corrected it

    reg.dispose(); // tears down the change subscription
    expect(offChange).toHaveBeenCalled();
  });
});
