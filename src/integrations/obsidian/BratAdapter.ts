// CON-OBS-INTEG-001 · T-B6-01 · INT-brat — adapter for obsidian42-brat.
//
// optimize() adds Diatonic-OS/sauce-crm@beta to BRAT's beta plugin list, but
// ONLY when the user opted in via `saucecrm.beta.enabled` (default off). The
// opt-in gate is read through the runtime host. This is the one adapter that
// supportsBeta() === true.

import type { App } from "obsidian";
import type {
  IObsidianPluginIntegration,
  PluginState,
  OptimizationPlan,
  OptimizationResult,
  OptimizationChange,
} from "./IObsidianPluginIntegration";

export const BRAT_PLUGIN_ID = "obsidian42-brat";
export const SAUCE_BETA_REPO = "Diatonic-OS/sauce-crm";

export interface BratRuntimeHost {
  isInstalled(): boolean;
  isEnabled(): boolean;
  getVersion(): string | null;
  /** Reads the Sauce setting `saucecrm.beta.enabled` (default false). */
  isBetaOptIn(): boolean;
  hasBetaPlugin(repo: string): boolean;
  addBetaPlugin(repo: string): void;
}

export interface SauceBratFacade {
  isAvailable(): boolean;
  isBetaEnabled(): boolean;
  registerBetaRepo(repo?: string): void;
}

export function buildBratRuntimeHost(
  app: App,
  isBetaOptIn: () => boolean,
  betaList: { has: (r: string) => boolean; add: (r: string) => void },
): BratRuntimeHost {
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
    isInstalled: () => !!get()?.plugins?.[BRAT_PLUGIN_ID],
    isEnabled: () => get()?.enabledPlugins?.has(BRAT_PLUGIN_ID) ?? false,
    getVersion: () => {
      const p = get()?.plugins?.[BRAT_PLUGIN_ID] as
        | { manifest?: { version?: string } }
        | undefined;
      return p?.manifest?.version ?? null;
    },
    isBetaOptIn,
    hasBetaPlugin: (r) => betaList.has(r),
    addBetaPlugin: (r) => betaList.add(r),
  };
}

export class BratAdapter implements IObsidianPluginIntegration {
  readonly id = BRAT_PLUGIN_ID;
  readonly label = "BRAT";
  readonly pluginId = BRAT_PLUGIN_ID;
  readonly pluginClass = "community" as const;

  constructor(private readonly runtime: BratRuntimeHost) {}

  /** True when there is a pending action: opted-in but the repo isn't registered. */
  private pending(): boolean {
    return (
      this.runtime.isBetaOptIn() && !this.runtime.hasBetaPlugin(SAUCE_BETA_REPO)
    );
  }

  async detect(): Promise<PluginState> {
    return {
      installed: this.runtime.isInstalled(),
      enabled: this.runtime.isEnabled(),
      version: this.runtime.getVersion(),
      // Opt-out respected: nothing to do ⇒ already "optimized".
      optimized: !this.pending(),
      compatible: true,
    };
  }

  async getOptimizationDiff(): Promise<OptimizationPlan> {
    const changes: OptimizationChange[] = this.pending()
      ? [
          {
            target: "brat:betaPluginList",
            key: SAUCE_BETA_REPO,
            from: null,
            to: `${SAUCE_BETA_REPO}@beta`,
            reason: "Add Sauce beta channel (opted in)",
          },
        ]
      : [];
    return { pluginId: this.pluginId, changes };
  }

  async optimize(): Promise<OptimizationResult> {
    try {
      if (!this.pending()) return { ok: true, applied: [] };
      this.runtime.addBetaPlugin(SAUCE_BETA_REPO);
      return {
        ok: true,
        applied: [
          {
            target: "brat:betaPluginList",
            key: SAUCE_BETA_REPO,
            from: null,
            to: `${SAUCE_BETA_REPO}@beta`,
            reason: "Add Sauce beta channel (opted in)",
          },
        ],
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
    const facade: SauceBratFacade = {
      isAvailable: () => this.runtime.isEnabled(),
      isBetaEnabled: () => this.runtime.isBetaOptIn(),
      registerBetaRepo: (repo = SAUCE_BETA_REPO) => {
        if (this.runtime.isBetaOptIn() && !this.runtime.hasBetaPlugin(repo))
          this.runtime.addBetaPlugin(repo);
      },
    };
    return facade as T;
  }

  supportsBeta(): boolean {
    return true;
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
