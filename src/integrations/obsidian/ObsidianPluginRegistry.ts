// CON-OBS-INTEG-001 · T-A-02 · A-001 amendment — registry for Obsidian plugin
// adapters.
//
// The existing IntegrationRegistry (src/integrations/IntegrationRegistry.ts) is
// a hardcoded 5-provider aggregate, NOT a generic registry (A-001 FALSE — see
// plan/obs-integ/00-validate.md). This is a NEW Map-backed registry that mirrors
// the *conceptual* role (register/get/list/dispose) for IObsidianPluginIntegration
// adapters. It drives the PluginStateMachine off live detection and emits state
// to an injected sink (the future EventBus / SVC-events satisfies RegistryEventSink
// structurally — kept out of scope here per "no scope creep").

import type { App } from "obsidian";
import type { IObsidianPluginIntegration } from "./IObsidianPluginIntegration";
import { PluginStateMachine, deriveStateFromFacts } from "./PluginStateMachine";

/** Channel the registry publishes per-plugin button-state changes on. */
export const REGISTRY_STATE_EVENT = "obsidian-plugin:state";

/** Structural event sink — the EventBus (SVC-events) will satisfy this. */
export interface RegistryEventSink {
  emit(event: string, payload: unknown): void;
}

export interface ObsidianPluginRegistryOptions {
  sink?: RegistryEventSink;
  stateMachine?: PluginStateMachine;
}

/**
 * Minimal shape of `app.plugins` we depend on. Obsidian's real object is an
 * untyped Events emitter; we only touch `on`/`offref`.
 */
interface PluginsEvents {
  on(name: string, cb: () => unknown): unknown;
  offref?(ref: unknown): void;
}

export class ObsidianPluginRegistry {
  private adapters = new Map<string, IObsidianPluginIntegration>();
  private disposers: Array<() => void> = [];
  private readonly sink?: RegistryEventSink;
  readonly stateMachine: PluginStateMachine;

  constructor(opts: ObsidianPluginRegistryOptions = {}) {
    this.sink = opts.sink;
    this.stateMachine = opts.stateMachine ?? new PluginStateMachine();
  }

  /** Register (or replace) an adapter by its plugin id. */
  register(adapter: IObsidianPluginIntegration): void {
    this.adapters.set(adapter.pluginId, adapter);
  }

  get(pluginId: string): IObsidianPluginIntegration | undefined {
    return this.adapters.get(pluginId);
  }

  has(pluginId: string): boolean {
    return this.adapters.has(pluginId);
  }

  list(): IObsidianPluginIntegration[] {
    return [...this.adapters.values()];
  }

  unregister(pluginId: string): boolean {
    return this.adapters.delete(pluginId);
  }

  /**
   * Re-detect every adapter, set the derived button state on the state machine,
   * and publish each state to the sink. Defensive: one adapter's detect()
   * throwing does not abort the others (it lands in ERROR).
   */
  async refresh(): Promise<void> {
    for (const adapter of this.adapters.values()) {
      try {
        const facts = await adapter.detect();
        const state = deriveStateFromFacts(facts);
        this.stateMachine.set(adapter.pluginId, state);
        this.sink?.emit(REGISTRY_STATE_EVENT, {
          pluginId: adapter.pluginId,
          state,
        });
      } catch (e) {
        this.stateMachine.set(adapter.pluginId, "ERROR");
        this.sink?.emit(REGISTRY_STATE_EVENT, {
          pluginId: adapter.pluginId,
          state: "ERROR",
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }
  }

  /**
   * Wire into the live app: refresh once the layout is ready, and again whenever
   * the community-plugin set changes. Registers teardown on dispose().
   */
  attach(app: App): void {
    const plugins = (app as unknown as { plugins?: PluginsEvents }).plugins;
    if (plugins?.on) {
      const ref = plugins.on("change", () => void this.refresh());
      this.disposers.push(() => plugins.offref?.(ref));
    }
    app.workspace?.onLayoutReady?.(() => void this.refresh());
  }

  /** Clear all adapters and run teardown (event unsubscribes). */
  dispose(): void {
    for (const off of this.disposers.splice(0)) {
      try {
        off();
      } catch {
        /* ignore teardown errors */
      }
    }
    this.adapters.clear();
  }
}
