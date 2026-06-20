// ─────────────────────────────────────────────────────────────────────────────
//  CONTROL LOOP — the deterministic spine of the SauceOM harness
// ─────────────────────────────────────────────────────────────────────────────
//
//  Per SAUCEOM_HARNESS_DIRECTIVE v0.1 @control_loop:
//    phases = [perceive, plan, act, observe, reconcile, recap]
//    invariant = "no cell -> resolved without a provenance event"
//
//  This strings the layers into one turn:
//    • perceive  — append user_input; run L1 analyzeInput; propose intent cells
//    • route     — L2 confidence_routing + read_between_lines. The HONESTY RULE:
//                  on low confidence / divergence / gaps, SURFACE the question;
//                  never silently guess into the store, never plan/act.
//    • plan      — the LLM (injected planner) proposes actions AS CANDIDATES;
//                  appended to the log as a plan event, NOT as commitments.
//    • act       — execute tool actions (gated by `approve`); answers accumulate.
//    • observe   — tool results force cell collapses (provenance preserved).
//    • reconcile — re-project cells; detect contradictions.
//    • recap     — <=3 line summary + ranked next_steps (L2 next_step_engine).
//
//  Everything deterministic lives HERE; the model is the one stochastic part,
//  injected as `planner`. Replaying the event log reproduces the turn exactly.

import { EventLog, CellEngine, type HarnessEvent } from "./L0Substrate";
import { analyzeInput, type AnalysisResult } from "./IntentSplit";
import {
  confidenceRouting,
  nextStepEngine,
  assembleSystemPrompt,
  readBetweenLines,
  type Route,
  type NextStep,
  type Gap,
} from "./Guidance";

/** An action the planner proposes. `answer` emits text; `tool` invokes a tool;
 *  `ask` defers back to the user. Candidates until executed — never auto-state. */
export interface PlannedAction {
  kind: "answer" | "tool" | "ask";
  text?: string;
  tool?: string;
  input?: Record<string, unknown>;
  /** Cell this action intends to resolve (collapsed from the tool result). */
  targetCell?: string;
  rationale?: string;
}

export interface PlanContext {
  systemPrompt: string;
  analysis: AnalysisResult;
  userText: string;
}

export interface ToolOutcome {
  ok: boolean;
  result?: unknown;
  error?: string;
  /** Candidate cell resolutions the result implies — collapsed in `observe`. */
  cellUpdates?: { cellId: string; value: unknown; confidence: number }[];
}

export interface ControlLoopDeps {
  /** The stochastic component: proposes action candidates. */
  planner: (ctx: PlanContext) => Promise<PlannedAction[]>;
  /** Executes a gated tool action. Absent ⇒ tool actions are skipped. */
  toolExec?: (action: PlannedAction) => Promise<ToolOutcome>;
  /** Override the L1 analysis (defaults to the heuristic analyzeInput). */
  analyze?: (text: string) => AnalysisResult;
  /** Approval gate for tool/dangerous actions. Default: allow. */
  approve?: (action: PlannedAction) => boolean;
  /** System-prompt base prepended to assembled resolved-cell facts. */
  basePrompt?: string;
}

export interface TurnResult {
  events: HarnessEvent[];
  route: Route;
  analysis: AnalysisResult;
  gaps: Gap[];
  output: string;
  recap: string;
  nextSteps: NextStep[];
  /** True iff at least one tool action executed. */
  acted: boolean;
}

export class ControlLoop {
  constructor(
    private readonly log: EventLog,
    private readonly cells: CellEngine,
    private readonly deps: ControlLoopDeps,
  ) {}

  async runTurn(userText: string, actor = "user"): Promise<TurnResult> {
    const startSeq = this.log.head()?.seq ?? -1;

    // ── PERCEIVE ────────────────────────────────────────────────────────────
    this.log.append({ type: "user_input", actor, payload: { text: userText } });
    const analyze = this.deps.analyze ?? analyzeInput;
    const analysis = analyze(userText);
    this.log.append({
      type: "intent_parse",
      actor: "harness",
      payload: {
        frame: analysis.frame,
        split: analysis.split,
        openQuestions: analysis.openQuestions,
      } as unknown as Record<string, unknown>,
    });
    // Propose intent cells (each carries provenance via its append event).
    this.cells.propose(
      "intent.logical",
      { value: analysis.split.logical.taskClass, confidence: analysis.split.logical.conf },
      "harness",
    );
    this.cells.propose(
      "intent.execution",
      { value: analysis.split.execution.concreteActions, confidence: analysis.split.execution.conf },
      "harness",
    );
    this.cells.propose(
      "intent.emotional",
      { value: analysis.split.emotional.need, confidence: analysis.split.emotional.conf },
      "harness",
    );

    // ── ROUTE (honesty rule) ─────────────────────────────────────────────────
    const route = confidenceRouting(analysis.split.logical.conf);
    const gaps = readBetweenLines({
      divergenceFlag: analysis.split.divergenceFlag,
      logicalConf: analysis.split.logical.conf,
    });
    const mustAsk =
      route === "ask" || analysis.split.divergenceFlag || gaps.length > 0;

    if (mustAsk) {
      // Surface the gap; do NOT plan/act or guess into the store.
      const nextSteps = nextStepEngine([...this.cells.cells().values()]);
      const recap = this.buildAskRecap(analysis, gaps, nextSteps);
      this.log.append({
        type: "recap",
        actor: "harness",
        payload: { recap, openQuestions: analysis.openQuestions, gaps },
      });
      this.log.append({
        type: "output",
        actor: "harness",
        payload: { text: recap, acted: false },
      });
      return {
        events: this.log.since(startSeq),
        // Divergence / gaps force the ask path even when confidence was high —
        // the EFFECTIVE route is ask.
        route: "ask",
        analysis,
        gaps,
        output: recap,
        recap,
        nextSteps,
        acted: false,
      };
    }

    // ── PLAN (candidates, not commitments) ───────────────────────────────────
    const systemPrompt = assembleSystemPrompt(
      [...this.cells.cells().values()],
      {
        ...(this.deps.basePrompt ? { base: this.deps.basePrompt } : {}),
        constraints: analysis.frame.how.constraints,
      },
    );
    const actions = await this.deps.planner({ systemPrompt, analysis, userText });
    this.log.append({
      type: "plan",
      actor: "model",
      payload: { candidates: actions as unknown as Record<string, unknown>[] },
    });

    // ── ACT + OBSERVE ────────────────────────────────────────────────────────
    let output = "";
    let acted = false;
    const approve = this.deps.approve ?? (() => true);
    for (const action of actions) {
      if (action.kind === "answer") {
        output += (output ? "\n" : "") + (action.text ?? "");
        continue;
      }
      if (action.kind === "tool" && this.deps.toolExec) {
        if (!approve(action)) {
          this.log.append({
            type: "tool_result",
            actor: "harness",
            payload: { tool: action.tool ?? "", skipped: true, reason: "not approved" },
          });
          continue;
        }
        this.log.append({
          type: "tool_call",
          actor: "harness",
          payload: { tool: action.tool ?? "", input: action.input ?? {} },
        });
        const outcome = await this.deps.toolExec(action);
        this.log.append({
          type: "tool_result",
          actor: "tool",
          payload: {
            tool: action.tool ?? "",
            ok: outcome.ok,
            ...(outcome.result !== undefined ? { result: outcome.result as unknown } : {}),
            ...(outcome.error !== undefined ? { error: outcome.error } : {}),
          },
        });
        acted = true;
        // OBSERVE — tool results force cell collapses (with provenance).
        for (const u of outcome.cellUpdates ?? []) {
          this.cells.propose(
            u.cellId,
            { value: u.value, confidence: u.confidence },
            `tool:${action.tool ?? ""}`,
          );
          this.cells.collapse(u.cellId);
        }
      }
    }

    // ── RECONCILE ────────────────────────────────────────────────────────────
    const allCells = [...this.cells.cells().values()];
    const contradictions = allCells.filter((c) => c.state === "contradicted");

    // ── RECAP ────────────────────────────────────────────────────────────────
    const nextSteps = nextStepEngine(allCells);
    const recap = this.buildActRecap(output, contradictions.length, nextSteps);
    this.log.append({
      type: "recap",
      actor: "harness",
      payload: { recap, contradictions: contradictions.map((c) => c.id) },
    });
    this.log.append({
      type: "output",
      actor: "harness",
      payload: { text: output, acted },
    });

    return {
      events: this.log.since(startSeq),
      route,
      analysis,
      gaps,
      output,
      recap,
      nextSteps,
      acted,
    };
  }

  /** <=3 line recap that surfaces the clarifying question instead of an answer. */
  private buildAskRecap(
    analysis: AnalysisResult,
    gaps: Gap[],
    nextSteps: NextStep[],
  ): string {
    const lines: string[] = [];
    const q =
      analysis.openQuestions[0] ??
      gaps[0]?.surface ??
      nextSteps[0]?.questionUserShouldAsk ??
      "Could you clarify what you'd like done?";
    lines.push(`I want to get this right before acting — ${q}`);
    if (gaps[0]) lines.push(`(${gaps[0].reason})`);
    return lines.slice(0, 3).join("\n");
  }

  /** <=3 line recap of what happened + the top next step. */
  private buildActRecap(
    output: string,
    contradictionCount: number,
    nextSteps: NextStep[],
  ): string {
    const lines: string[] = [];
    lines.push(output ? "Done." : "Completed the turn.");
    if (contradictionCount > 0) {
      lines.push(`Heads up: ${contradictionCount} conflicting fact(s) need a decision.`);
    }
    if (nextSteps[0]) lines.push(`Next: ${nextSteps[0].suggestedNextAction}`);
    return lines.slice(0, 3).join("\n");
  }
}
