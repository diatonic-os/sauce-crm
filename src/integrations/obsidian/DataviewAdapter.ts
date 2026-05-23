// CON-OBS-INTEG-001 · T-B2-01 · INT-dataview — adapter for the dataview plugin.
//
// Same template as TasksAdapter: detect/optimize delegate to PluginConfigService;
// getServiceFacade() wraps dv.api with a typed Sauce surface (never the raw api,
// G-010 / R-003). optimize() enables dataviewjs and registers the sauce inline
// resolvers via the runtime host.

import type { App } from "obsidian";
import type {
  IObsidianPluginIntegration,
  PluginState,
  OptimizationPlan,
  OptimizationResult,
  OptimizationChange,
} from "./IObsidianPluginIntegration";
import {
  PluginConfigService,
  type CanonicalProfile,
  type ConfigChange,
} from "../../services/PluginConfigService";

export const DATAVIEW_PLUGIN_ID = "dataview";
const DATA_JSON = `.obsidian/plugins/${DATAVIEW_PLUGIN_ID}/data.json`;

/** INT-dataview: optimized iff data.json has enableDataviewJs + dataviewJsKeyword. */
export const SAUCE_DATAVIEW_PROFILE: CanonicalProfile = {
  id: DATAVIEW_PLUGIN_ID,
  kind: "community",
  label: "Dataview",
  settings: { enableDataviewJs: true, dataviewJsKeyword: "dataviewjs" },
};

/** Documented dataview api subset (dv.api). */
export interface DataviewApi {
  pages(source?: string): unknown[];
  pagePaths(source?: string): string[];
  query(source: string): Promise<unknown>;
}

/** Typed Sauce facade over dv.api. */
export interface SauceDataviewFacade {
  isAvailable(): boolean;
  pages(source?: string): unknown[];
  pagePaths(source?: string): string[];
  query(source: string): Promise<unknown>;
}

export interface DataviewRuntimeHost {
  isEnabled(): boolean;
  getVersion(): string | null;
  getApi(): DataviewApi | null;
  /** Register `sauce:` page-resolver + graph-resolver inline renderers on optimize. */
  registerInlineResolvers?(): void;
}

export function buildDataviewRuntimeHost(app: App): DataviewRuntimeHost {
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
    isEnabled: () => get()?.enabledPlugins?.has(DATAVIEW_PLUGIN_ID) ?? false,
    getVersion: () => {
      const p = get()?.plugins?.[DATAVIEW_PLUGIN_ID] as
        | { manifest?: { version?: string } }
        | undefined;
      return p?.manifest?.version ?? null;
    },
    getApi: () => {
      const p = get()?.plugins?.[DATAVIEW_PLUGIN_ID] as
        | { api?: DataviewApi }
        | undefined;
      return p?.api ?? null;
    },
  };
}

function toChange(c: ConfigChange): OptimizationChange {
  return {
    target: DATA_JSON,
    key: c.key,
    from: c.from,
    to: c.to,
    reason: "Sauce Dataview defaults",
  };
}

export class DataviewAdapter implements IObsidianPluginIntegration {
  readonly id = DATAVIEW_PLUGIN_ID;
  readonly label = "Dataview";
  readonly pluginId = DATAVIEW_PLUGIN_ID;
  readonly pluginClass = "community" as const;

  constructor(
    private readonly config: PluginConfigService,
    private readonly runtime: DataviewRuntimeHost,
    private readonly profile: CanonicalProfile = SAUCE_DATAVIEW_PROFILE,
  ) {}

  async detect(): Promise<PluginState> {
    const st = await this.config.status(this.profile);
    return {
      installed: st.state !== "not-installed",
      enabled: this.runtime.isEnabled(),
      version: this.runtime.getVersion(),
      optimized: st.state === "configured",
      compatible: true,
    };
  }

  async getOptimizationDiff(): Promise<OptimizationPlan> {
    const st = await this.config.status(this.profile);
    return { pluginId: this.pluginId, changes: st.changes.map(toChange) };
  }

  async optimize(): Promise<OptimizationResult> {
    try {
      const applied = await this.config.apply(this.profile);
      if (applied.length > 0) this.runtime.registerInlineResolvers?.();
      return { ok: true, applied: applied.map(toChange) };
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
    const facade: SauceDataviewFacade = {
      isAvailable: () => getApi() !== null,
      pages: (source?: string) => getApi()?.pages(source) ?? [],
      pagePaths: (source?: string) => getApi()?.pagePaths(source) ?? [],
      query: (source: string) => {
        const api = getApi();
        return api
          ? api.query(source)
          : Promise.reject(new Error("Dataview api unavailable"));
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
