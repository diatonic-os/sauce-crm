// CON-OBS-INTEG-001 · T-B4-01 · INT-metabind — adapter for obsidian-meta-bind-plugin.
//
// optimize() registers Sauce's typed read-only bind targets (sauce:person.*,
// sauce:org.*, sauce:touch.*) through the runtime host; optimized iff they are
// present. Facade exposes registration + introspection, never the raw plugin.

import type { App } from "obsidian";
import type {
  IObsidianPluginIntegration,
  PluginState,
  OptimizationPlan,
  OptimizationResult,
  OptimizationChange,
} from "./IObsidianPluginIntegration";

export const METABIND_PLUGIN_ID = "obsidian-meta-bind-plugin";

/** Read-only entity-form bind targets Sauce registers (INT-metabind). */
export const SAUCE_BIND_TARGETS = [
  "sauce:person.*",
  "sauce:org.*",
  "sauce:touch.*",
] as const;

export interface MetaBindRuntimeHost {
  isInstalled(): boolean;
  isEnabled(): boolean;
  getVersion(): string | null;
  /** Which sauce:* bind targets are currently registered. */
  registeredTargets(): string[];
  registerTargets(targets: string[]): void;
}

export interface SauceMetaBindFacade {
  isAvailable(): boolean;
  listBindTargets(): string[];
  registerBindTargets(): void;
}

export function buildMetaBindRuntimeHost(
  app: App,
  registered: () => string[],
  register: (t: string[]) => void,
): MetaBindRuntimeHost {
  // app.plugins is a real runtime API not exposed in Obsidian's public .d.ts.
  const get = () =>
    (
      app as unknown as {
        plugins?: {
          plugins?: Record<string, unknown>;
          enabledPlugins?: Set<string>;
        };
      }
    ).plugins;
  return {
    isInstalled: () => !!get()?.plugins?.[METABIND_PLUGIN_ID],
    isEnabled: () => get()?.enabledPlugins?.has(METABIND_PLUGIN_ID) ?? false,
    getVersion: () => {
      const p = get()?.plugins?.[METABIND_PLUGIN_ID] as
        | { manifest?: { version?: string } }
        | undefined;
      return p?.manifest?.version ?? null;
    },
    registeredTargets: registered,
    registerTargets: register,
  };
}

export class MetaBindAdapter implements IObsidianPluginIntegration {
  readonly id = METABIND_PLUGIN_ID;
  readonly label = "Meta Bind";
  readonly pluginId = METABIND_PLUGIN_ID;
  readonly pluginClass = "community" as const;

  constructor(private readonly runtime: MetaBindRuntimeHost) {}

  private missingTargets(): string[] {
    const have = new Set(this.runtime.registeredTargets());
    return SAUCE_BIND_TARGETS.filter((t) => !have.has(t));
  }

  async detect(): Promise<PluginState> {
    return {
      installed: this.runtime.isInstalled(),
      enabled: this.runtime.isEnabled(),
      version: this.runtime.getVersion(),
      optimized: this.missingTargets().length === 0,
      compatible: true,
    };
  }

  async getOptimizationDiff(): Promise<OptimizationPlan> {
    const changes: OptimizationChange[] = this.missingTargets().map((t) => ({
      target: "metabind:bindTargets",
      key: t,
      from: null,
      to: t,
      reason: "Register Sauce read-only entity bind target",
    }));
    return { pluginId: this.pluginId, changes };
  }

  async optimize(): Promise<OptimizationResult> {
    try {
      const missing = this.missingTargets();
      if (missing.length > 0) this.runtime.registerTargets(missing);
      return {
        ok: true,
        applied: missing.map((t) => ({
          target: "metabind:bindTargets",
          key: t,
          from: null,
          to: t,
          reason: "Register Sauce read-only entity bind target",
        })),
      };
    } catch (e) {
      return {
        ok: false,
        applied: [],
        error: e instanceof Error ? e.message : String(e),
      };
    }
  }

  getServiceFacade<T>(): T {
    const facade: SauceMetaBindFacade = {
      isAvailable: () => this.runtime.isEnabled(),
      listBindTargets: () => [...SAUCE_BIND_TARGETS],
      registerBindTargets: () =>
        this.runtime.registerTargets(this.missingTargets()),
    };
    return facade as T;
  }

  supportsBeta(): boolean {
    return false;
  }

  async connect(): Promise<{ connected: boolean }> {
    return { connected: this.runtime.isEnabled() };
  }
  async disconnect(): Promise<void> {}
  async state(): Promise<{ connected: boolean }> {
    return { connected: this.runtime.isEnabled() };
  }
  async listResources(): Promise<[]> {
    return [];
  }
  async syncResource(): Promise<{
    pulled: number;
    pushed: number;
    errors: number;
  }> {
    return { pulled: 0, pushed: 0, errors: 0 };
  }
}
