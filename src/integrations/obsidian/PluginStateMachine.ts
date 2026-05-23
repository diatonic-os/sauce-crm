// CON-OBS-INTEG-001 · T-A-03 · DEC-001 / S-button — the Install→Optimize
// button state machine.
//
// Two layers:
//   1. `reduce` + `deriveStateFromFacts` — PURE functions (no Obsidian API,
//      no I/O). The transition table is the S-button contract verbatim.
//   2. `PluginStateMachine` — a thin stateful holder that tracks one button
//      state per plugin id, emits typed transitions on change, and exposes a
//      persistable snapshot (data.json `saucecrm.pluginStates`).

import type {
  PluginButtonState,
  PluginButtonEvent,
  PluginState,
} from "./IObsidianPluginIntegration";

/** S-button-labels (DEC-001 label table). */
export const BUTTON_LABELS: Readonly<Record<PluginButtonState, string>> = {
  NOT_INSTALLED: "Install",
  INSTALLING: "Installing…",
  INSTALLED: "Detecting…",
  OPTIMIZABLE: "Optimize for Sauce",
  OPTIMIZING: "Optimizing…",
  OPTIMIZED: "Configured ✓",
  OUTDATED: "Update & Re-optimize",
  DISABLED: "Enable",
  INCOMPATIBLE: "Incompatible — check minAppVersion",
  ERROR: "Retry",
};

/** Specific (from,event)→to transitions from the S-button table. */
const TRANSITIONS: Partial<
  Record<
    PluginButtonState,
    Partial<Record<PluginButtonEvent, PluginButtonState>>
  >
> = {
  NOT_INSTALLED: { install: "INSTALLING" },
  INSTALLING: { installed: "INSTALLED" },
  INSTALLED: { detectUnoptimized: "OPTIMIZABLE", detectOptimized: "OPTIMIZED" },
  OPTIMIZABLE: { optimize: "OPTIMIZING" },
  OPTIMIZING: { applied: "OPTIMIZED" },
  OPTIMIZED: { newVersionAvailable: "OUTDATED" },
  OUTDATED: { updateAndOptimize: "OPTIMIZING" },
  DISABLED: { userEnable: "INSTALLED" },
  ERROR: { retry: "INSTALLED" },
};

/** Wildcard events (`from: "*"`): apply from any state. */
const WILDCARD: Partial<Record<PluginButtonEvent, PluginButtonState>> = {
  userDisable: "DISABLED",
  versionMismatch: "INCOMPATIBLE",
  error: "ERROR",
};

/**
 * The pure S-button reducer. Returns the next state, or the same state when no
 * transition is defined for `(state, event)` — never throws, never mutates.
 */
export function reduce(
  state: PluginButtonState,
  event: PluginButtonEvent,
): PluginButtonState {
  const specific = TRANSITIONS[state]?.[event];
  if (specific) return specific;
  const wild = WILDCARD[event];
  if (wild) return wild;
  return state;
}

/**
 * Map `detect()` facts to an initial button state. Order matters: install →
 * compatibility → enablement → freshness → optimization.
 */
export function deriveStateFromFacts(facts: PluginState): PluginButtonState {
  if (!facts.installed) return "NOT_INSTALLED";
  if (!facts.compatible) return "INCOMPATIBLE";
  if (!facts.enabled) return "DISABLED";
  if (facts.optimized && facts.updateAvailable) return "OUTDATED";
  if (facts.optimized) return "OPTIMIZED";
  return "OPTIMIZABLE";
}

/** A typed transition record emitted on every state change. */
export interface PluginTransition {
  pluginId: string;
  from: PluginButtonState;
  to: PluginButtonState;
  event: PluginButtonEvent;
}

/** Persistable shape stored at data.json `saucecrm.pluginStates`. */
export type PluginStatesSnapshot = Record<string, PluginButtonState>;

export interface PluginStateMachineOptions {
  /** Called with the full snapshot after any change, for data.json persistence. */
  onPersist?: (snapshot: PluginStatesSnapshot) => void;
}

const DEFAULT_STATE: PluginButtonState = "NOT_INSTALLED";

/**
 * Stateful holder over the pure reducer. One button state per plugin id;
 * emits typed transitions on change; snapshot()/hydrate() round-trip the
 * persistable record.
 */
export class PluginStateMachine {
  private states = new Map<string, PluginButtonState>();
  private listeners = new Set<(t: PluginTransition) => void>();
  private readonly onPersist?: (snapshot: PluginStatesSnapshot) => void;

  constructor(opts: PluginStateMachineOptions = {}) {
    this.onPersist = opts.onPersist;
  }

  /** Current button state for a plugin (DEFAULT_STATE when unseen). */
  get(pluginId: string): PluginButtonState {
    return this.states.get(pluginId) ?? DEFAULT_STATE;
  }

  /** Force-set a state (e.g. from a fresh detect()). Emits + persists on change. */
  set(pluginId: string, state: PluginButtonState): void {
    const from = this.get(pluginId);
    if (from === state && this.states.has(pluginId)) return;
    this.states.set(pluginId, state);
    if (from !== state)
      this.emit({ pluginId, from, to: state, event: "installed" });
    this.persist();
  }

  /** Apply an event through the pure reducer. No-op (no emit) on illegal pairs. */
  dispatch(pluginId: string, event: PluginButtonEvent): PluginButtonState {
    const from = this.get(pluginId);
    const to = reduce(from, event);
    if (to === from) return from; // illegal/no-op transition: stay silent
    this.states.set(pluginId, to);
    this.emit({ pluginId, from, to, event });
    this.persist();
    return to;
  }

  /** Subscribe to typed transitions. Returns an unsubscribe fn. */
  onTransition(fn: (t: PluginTransition) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** The persistable snapshot for data.json `saucecrm.pluginStates`. */
  snapshot(): PluginStatesSnapshot {
    return Object.fromEntries(this.states);
  }

  /** Restore a persisted snapshot (replaces current in-memory states). */
  hydrate(snapshot: PluginStatesSnapshot | undefined | null): void {
    this.states.clear();
    for (const [id, st] of Object.entries(snapshot ?? {}))
      this.states.set(id, st);
  }

  private emit(t: PluginTransition): void {
    for (const fn of this.listeners) fn(t);
  }

  private persist(): void {
    this.onPersist?.(this.snapshot());
  }
}
