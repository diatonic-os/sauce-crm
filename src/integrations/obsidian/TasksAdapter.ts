// CON-OBS-INTEG-001 · T-B1-01 · INT-tasks — adapter for the obsidian-tasks-plugin.
//
// Thin IObsidianPluginIntegration over the existing PluginConfigService engine:
// status() drives detect()/getOptimizationDiff(), apply() drives optimize() (it
// already does diff + backup + provenance trace and leaves non-canonical keys
// intact). On top we add getServiceFacade(), a typed Sauce wrapper around the
// plugin's apiV1 — which never returns the raw handle (R-003 / G-010).
//
// The full apiV1 surface is auto-enumerated by SH-F (`obsidian eval` against a
// live vault, currently BLOCKED — see plan/obs-integ/00-validate.md A-006); here
// we wrap the 3 documented methods.

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

export const TASKS_PLUGIN_ID = "obsidian-tasks-plugin";
const DATA_JSON = `.obsidian/plugins/${TASKS_PLUGIN_ID}/data.json`;

/** Canonical Sauce defaults (INT-tasks: optimized iff data.json ⊇ these keys
 *  with dateFormat 'YYYY-MM-DD'). */
export const SAUCE_TASKS_PROFILE: CanonicalProfile = {
  id: TASKS_PLUGIN_ID,
  kind: "community",
  label: "Tasks",
  settings: {
    globalFilter: "#task",
    setCreatedDate: true,
    setDoneDate: true,
    dateFormat: "YYYY-MM-DD",
  },
};

/** The documented obsidian-tasks-plugin apiV1 surface (A-006; SH-F enumerates the rest). */
export interface TasksApiV1 {
  createTaskLineModal(): Promise<string>;
  editTaskLineModal(taskLine: string): Promise<string>;
  executeToggleTaskDoneCommand(line: string, path: string): string;
}

/** Typed Sauce facade over apiV1 — the only surface downstream code touches. */
export interface SauceTasksFacade {
  isAvailable(): boolean;
  createTaskLine(): Promise<string>;
  editTaskLine(line: string): Promise<string>;
  toggleDone(line: string, path: string): string;
}

/** Runtime glue (injected) — enablement, version, and the live apiV1 handle. */
export interface TasksRuntimeHost {
  isEnabled(): boolean;
  getVersion(): string | null;
  getApiV1(): TasksApiV1 | null;
  /** Optional: register the `sauce-crm/tasks` slash-command alias on optimize. */
  registerCommandAlias?(): void;
}

/** Build a TasksRuntimeHost from a live Obsidian App. */
export function buildTasksRuntimeHost(app: App): TasksRuntimeHost {
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
    isEnabled: () => get()?.enabledPlugins?.has(TASKS_PLUGIN_ID) ?? false,
    getVersion: () => {
      const p = get()?.plugins?.[TASKS_PLUGIN_ID] as
        | { manifest?: { version?: string } }
        | undefined;
      return p?.manifest?.version ?? null;
    },
    getApiV1: () => {
      const p = get()?.plugins?.[TASKS_PLUGIN_ID] as
        | { apiV1?: TasksApiV1 }
        | undefined;
      return p?.apiV1 ?? null;
    },
  };
}

function toChange(c: ConfigChange): OptimizationChange {
  return {
    target: DATA_JSON,
    key: c.key,
    from: c.from,
    to: c.to,
    reason: "Sauce Tasks defaults",
  };
}

export class TasksAdapter implements IObsidianPluginIntegration {
  readonly id = TASKS_PLUGIN_ID;
  readonly label = "Tasks";
  readonly pluginId = TASKS_PLUGIN_ID;
  readonly pluginClass = "community" as const;

  constructor(
    private readonly config: PluginConfigService,
    private readonly runtime: TasksRuntimeHost,
    private readonly profile: CanonicalProfile = SAUCE_TASKS_PROFILE,
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
      if (applied.length > 0) this.runtime.registerCommandAlias?.();
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
    const getApi = () => this.runtime.getApiV1();
    const facade: SauceTasksFacade = {
      isAvailable: () => getApi() !== null,
      createTaskLine: () => {
        const api = getApi();
        return api
          ? api.createTaskLineModal()
          : Promise.reject(new Error("Tasks apiV1 unavailable"));
      },
      editTaskLine: (line: string) => {
        const api = getApi();
        return api
          ? api.editTaskLineModal(line)
          : Promise.reject(new Error("Tasks apiV1 unavailable"));
      },
      toggleDone: (line: string, path: string) => {
        const api = getApi();
        if (!api) throw new Error("Tasks apiV1 unavailable");
        return api.executeToggleTaskDoneCommand(line, path);
      },
    };
    return facade as T;
  }

  supportsBeta(): boolean {
    return false;
  }

  // ── IIntegration members (the adapter is a first-class integration) ──
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
