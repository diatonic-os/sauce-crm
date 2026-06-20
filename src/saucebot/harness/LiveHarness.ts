// ─────────────────────────────────────────────────────────────────────────────
//  LIVE HARNESS — @live_harness layer of the SAUCEOM_HARNESS_DIRECTIVE
//
//  Per SAUCEOM_HARNESS_DIRECTIVE v0.1 @live_harness:
//    "assembles a ControlLoop whose planner is a real provider"
//    "persistence hook injectable — no harness-internal I/O"
//    "pure module: no obsidian, no lancedb"
//
//  This is the bridge called from SauceBotRuntime (do NOT edit runtime here).
//  All side-effecting capabilities (shell, persistence, service calls) are
//  injected as function deps so the module is unit-testable with fakes.
// ─────────────────────────────────────────────────────────────────────────────

import { EventLog, CellEngine, type HarnessEvent } from "./L0Substrate";
import {
  ControlLoop,
  type PlannedAction,
  type TurnResult,
} from "./ControlLoop";
import { collectText } from "./ProviderHarness";
import type { ISauceBotProvider } from "../ISauceBotProvider";

// ═══════════════════════════════════════════════════════════════════════════
//  PUBLIC TYPES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * The shape a tool executor must satisfy — mirrors ControlLoop's toolExec
 * parameter so callers can reuse ControlLoop's type without a separate import.
 */
export type ControlLoopToolExec = (action: PlannedAction) => Promise<{
  ok: boolean;
  result?: unknown;
  error?: string;
  cellUpdates?: { cellId: string; value: unknown; confidence: number }[];
}>;

/**
 * Dependency bundle for `createLiveHarness`.
 * All fields except `provider` and `model` are optional — the harness is
 * functional with only those two supplied.
 */
export interface LiveHarnessDeps {
  /** The inference provider to call for planning turns. */
  provider: ISauceBotProvider;
  /** Model id passed to `collectText` in the planner. */
  model: string;
  /** Optional system-prompt base prepended to resolved-cell facts. */
  basePrompt?: string;
  /** Optional tool executor wired into ControlLoop. */
  toolExec?: ControlLoopToolExec;
  /**
   * Optional persistence hook. Called once for each new {@link HarnessEvent}
   * in the {@link TurnResult}'s `.events` array after every `runTurn`.
   * Hook receives events in sequence order.
   */
  persist?: (e: HarnessEvent) => void;
}

// ═══════════════════════════════════════════════════════════════════════════
//  FACTORY
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Assemble a ControlLoop whose planner calls `collectText` against a real
 * (or fake-injectable) {@link ISauceBotProvider}.
 *
 * The returned object exposes:
 * - `runTurn(text)` — run one turn through the full harness pipeline and
 *   return the deterministic {@link TurnResult}.
 * - `events()` — the complete, append-only event log for the session.
 *
 * Persistence is handled by calling `deps.persist` for each event in
 * `TurnResult.events` after every turn — no EventLog internals are touched.
 *
 * @example
 * ```ts
 * const harness = createLiveHarness({ provider, model: "llama3", persist: db.append });
 * const result = await harness.runTurn("Summarize my notes on [[Jane]]");
 * ```
 */
export function createLiveHarness(deps: LiveHarnessDeps): {
  runTurn: (text: string) => Promise<TurnResult>;
  events: () => readonly HarnessEvent[];
} {
  const log = new EventLog();
  const cells = new CellEngine(log);

  const loop = new ControlLoop(log, cells, {
    planner: async (ctx) => {
      const text = await collectText(deps.provider, {
        model: deps.model,
        messages: [{ role: "user", content: ctx.userText }],
        systemPrompt: ctx.systemPrompt,
        stream: false,
      });
      const action: PlannedAction = { kind: "answer", text };
      return [action];
    },
    ...(deps.toolExec ? { toolExec: deps.toolExec } : {}),
    ...(deps.basePrompt ? { basePrompt: deps.basePrompt } : {}),
  });

  return {
    async runTurn(text: string): Promise<TurnResult> {
      const result = await loop.runTurn(text);

      if (deps.persist) {
        for (const event of result.events) {
          deps.persist(event);
        }
      }

      return result;
    },

    events(): readonly HarnessEvent[] {
      return log.all();
    },
  };
}
