// CON-OBS-INTEG-001 · T-A-01 · DEC-005 — the adapter contract for inheriting &
// optimizing an Obsidian core/community plugin as a Sauce service layer.
//
// Extends the existing IIntegration (src/integrations/IIntegration.ts) so a
// plugin adapter is a first-class integration, and adds the state-aware
// Install→Optimize surface (DEC-001 / S-button) plus a typed service facade
// (R-003 / G-010: facades never leak a raw Obsidian API handle).

import type { IIntegration } from "../IIntegration";

/** The 10 button states (DEC-001 / S-button). Drives the Install→Optimize UI. */
export type PluginButtonState =
  | "NOT_INSTALLED"
  | "INSTALLING"
  | "INSTALLED"
  | "OPTIMIZABLE"
  | "OPTIMIZING"
  | "OPTIMIZED"
  | "OUTDATED"
  | "DISABLED"
  | "INCOMPATIBLE"
  | "ERROR";

/** Events that drive S-button transitions (DEC-001 transition table). */
export type PluginButtonEvent =
  | "install"
  | "installed"
  | "detectUnoptimized"
  | "detectOptimized"
  | "optimize"
  | "applied"
  | "newVersionAvailable"
  | "updateAndOptimize"
  | "userDisable"
  | "userEnable"
  | "versionMismatch"
  | "error"
  | "retry";

/**
 * Detected reality of a plugin at a point in time. `detect()` returns these
 * facts; the PluginStateMachine derives the button state from facts + events.
 * Keeping detection (impure) and derivation (pure) separate is what makes the
 * reducer testable.
 */
export interface PluginState {
  /** Plugin directory present under .obsidian/plugins (community) or known core id. */
  installed: boolean;
  /** Currently enabled in app.plugins / app.internalPlugins. */
  enabled: boolean;
  /** Installed version from the plugin manifest, or null when unknown/core. */
  version: string | null;
  /** True iff the plugin's data.json already matches Sauce's optimized defaults. */
  optimized: boolean;
  /** False iff the plugin's minAppVersion/version is incompatible with this host. */
  compatible: boolean;
  /** A newer version is available upstream (drives OUTDATED). */
  updateAvailable?: boolean;
}

/** One concrete change `optimize()` would make (a data.json key patch, a registration, …). */
export interface OptimizationChange {
  /** Logical target, e.g. ".obsidian/plugins/<id>/data.json" or "command:<id>". */
  target: string;
  key: string;
  from: unknown;
  to: unknown;
  reason: string;
}

/** The diff `getOptimizationDiff()` returns: what optimize() will do, before doing it. */
export interface OptimizationPlan {
  pluginId: string;
  /** Empty when already optimized. */
  changes: OptimizationChange[];
}

/** Outcome of applying an OptimizationPlan. */
export interface OptimizationResult {
  ok: boolean;
  applied: OptimizationChange[];
  error?: string;
}

/**
 * DEC-005 — IObsidianPluginIntegration extends IIntegration with the
 * state-aware optimize surface and a typed service facade.
 */
export interface IObsidianPluginIntegration extends IIntegration {
  /** The Obsidian plugin id this adapter inherits (e.g. "obsidian-tasks-plugin"). */
  readonly pluginId: string;
  /** Whether this is a community plugin or a built-in core plugin. */
  readonly pluginClass: "community" | "core";

  /** Inspect the live app + plugin data.json and report current facts. */
  detect(): Promise<PluginState>;

  /** Apply Sauce's optimized defaults. Idempotent — a no-op when already optimized. */
  optimize(): Promise<OptimizationResult>;

  /**
   * Return a typed Sauce facade wrapping the plugin's API (R-003 / G-010 — never
   * the raw Obsidian handle). `T` is the adapter-specific facade type.
   */
  getServiceFacade<T>(): T;

  /** Preview what optimize() would change, without applying it. */
  getOptimizationDiff(): Promise<OptimizationPlan>;

  /** Whether this adapter participates in the BRAT beta channel (DEC-008). */
  supportsBeta(): boolean;
}
