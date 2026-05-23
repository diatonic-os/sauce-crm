// CON-OBS-INTEG-001 · T-B5-01 · INT-quickadd — adapter for the quickadd plugin.
//
// optimize() inserts 4 Sauce capture choices into the plugin's data.json
// `choices` array. Because that's an array-append (not a key replace), it can't
// use PluginConfigService's shallow merge — the adapter does an idempotent
// append directly through a PluginConfigHost. Facade wraps quickadd.api.

import type { App } from "obsidian";
import type {
  IObsidianPluginIntegration,
  PluginState,
  OptimizationPlan,
  OptimizationResult,
  OptimizationChange,
} from "./IObsidianPluginIntegration";
import type { PluginConfigHost } from "../../services/PluginConfigService";

export const QUICKADD_PLUGIN_ID = "quickadd";
const DATA_JSON = `.obsidian/plugins/${QUICKADD_PLUGIN_ID}/data.json`;

export interface QuickAddChoice {
  id: string;
  name: string;
}

/** The 4 Sauce capture choices (INT-quickadd). */
export const SAUCE_QUICKADD_CHOICES: readonly QuickAddChoice[] = [
  { id: "sauce-new-touch", name: "Sauce: New Touch" },
  { id: "sauce-new-person", name: "Sauce: New Person" },
  { id: "sauce-new-idea", name: "Sauce: New Idea" },
  { id: "sauce-capture-inbox", name: "Sauce: Capture to Inbox" },
];

/** Documented quickadd api subset. */
export interface QuickAddApi {
  executeChoice(
    choiceName: string,
    variables?: Record<string, unknown>,
  ): Promise<void>;
}

export interface SauceQuickAddFacade {
  isAvailable(): boolean;
  listSauceChoices(): QuickAddChoice[];
  capture(
    choiceName: string,
    variables?: Record<string, unknown>,
  ): Promise<void>;
}

export interface QuickAddRuntimeHost {
  isEnabled(): boolean;
  getVersion(): string | null;
  getApi(): QuickAddApi | null;
}

export function buildQuickAddRuntimeHost(app: App): QuickAddRuntimeHost {
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
    isEnabled: () => get()?.enabledPlugins?.has(QUICKADD_PLUGIN_ID) ?? false,
    getVersion: () => {
      const p = get()?.plugins?.[QUICKADD_PLUGIN_ID] as
        | { manifest?: { version?: string } }
        | undefined;
      return p?.manifest?.version ?? null;
    },
    getApi: () => {
      const p = get()?.plugins?.[QUICKADD_PLUGIN_ID] as
        | { api?: QuickAddApi }
        | undefined;
      return p?.api ?? null;
    },
  };
}

function existingNames(data: Record<string, unknown> | null): Set<string> {
  const choices = (data?.choices as Array<{ name?: string }> | undefined) ?? [];
  return new Set(
    choices
      .map((c) => c.name)
      .filter((n): n is string => typeof n === "string"),
  );
}

export class QuickAddAdapter implements IObsidianPluginIntegration {
  readonly id = QUICKADD_PLUGIN_ID;
  readonly label = "QuickAdd";
  readonly pluginId = QUICKADD_PLUGIN_ID;
  readonly pluginClass = "community" as const;

  constructor(
    private readonly host: PluginConfigHost,
    private readonly runtime: QuickAddRuntimeHost,
  ) {}

  private async missing(): Promise<QuickAddChoice[]> {
    const data = await this.host.readConfig(QUICKADD_PLUGIN_ID, "community");
    const have = existingNames(data);
    return SAUCE_QUICKADD_CHOICES.filter((c) => !have.has(c.name));
  }

  async detect(): Promise<PluginState> {
    const installed = this.host.isInstalled(QUICKADD_PLUGIN_ID, "community");
    return {
      installed,
      enabled: this.runtime.isEnabled(),
      version: this.runtime.getVersion(),
      optimized: installed && (await this.missing()).length === 0,
      compatible: true,
    };
  }

  async getOptimizationDiff(): Promise<OptimizationPlan> {
    const changes: OptimizationChange[] = (await this.missing()).map((c) => ({
      target: DATA_JSON,
      key: `choices[+]`,
      from: null,
      to: c.name,
      reason: "Insert Sauce capture choice",
    }));
    return { pluginId: this.pluginId, changes };
  }

  async optimize(): Promise<OptimizationResult> {
    try {
      const missing = await this.missing();
      if (missing.length === 0) return { ok: true, applied: [] };
      const data =
        (await this.host.readConfig(QUICKADD_PLUGIN_ID, "community")) ?? {};
      await this.host.backupConfig(QUICKADD_PLUGIN_ID, "community", data);
      const choices = Array.isArray(data.choices)
        ? [...(data.choices as unknown[])]
        : [];
      for (const c of missing)
        choices.push({ id: c.id, name: c.name, type: "Macro" });
      await this.host.writeConfig(QUICKADD_PLUGIN_ID, "community", {
        ...data,
        choices,
      });
      return {
        ok: true,
        applied: missing.map((c) => ({
          target: DATA_JSON,
          key: "choices[+]",
          from: null,
          to: c.name,
          reason: "Insert Sauce capture choice",
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
    const getApi = () => this.runtime.getApi();
    const facade: SauceQuickAddFacade = {
      isAvailable: () => getApi() !== null,
      listSauceChoices: () => [...SAUCE_QUICKADD_CHOICES],
      capture: (name: string, variables?: Record<string, unknown>) => {
        const api = getApi();
        return api
          ? api.executeChoice(name, variables)
          : Promise.reject(new Error("QuickAdd api unavailable"));
      },
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
