// ─────────────────────────────────────────────────────────────────────────────
//  PROVIDER HARNESS — make the quality stages work across ALL provider endpoints
// ─────────────────────────────────────────────────────────────────────────────
//
//  The quality machinery (VerifyStage) is provider-agnostic by design — it takes
//  an injected `generate` function. This module is the bridge: it turns the
//  unified streaming `ISauceBotProvider.complete()` surface (which Anthropic,
//  OpenAI, LM Studio REST, LM Studio SDK, Ollama, NIM, OpenRouter, Groq, Gemini
//  all implement) into the simple text generator the harness needs.
//
//  Result: self-consistency voting + critique-revise run IDENTICALLY on every
//  provider, with zero per-provider branching. One harness, all endpoints.

import type {
  ISauceBotProvider,
  CompletionRequest,
} from "../ISauceBotProvider";
import type { ProviderHarness } from "../ProviderRegistry";
import {
  verify,
  type Critic,
  type Reviser,
  type VerifyResult,
} from "./VerifyStage";

export interface CollectedCompletion {
  /** The assembled answer text (concatenated `text` deltas). */
  text: string;
  /** Reasoning/chain-of-thought stream, kept separate from the answer. */
  reasoning: string;
  toolUses: Array<{ id: string; name: string; input: unknown }>;
  inputTokens: number;
  outputTokens: number;
  doneReason:
    | "end_turn"
    | "tool_use"
    | "max_tokens"
    | "stop"
    | "error"
    | "unknown";
  error?: string;
}

/** Drain a provider's event stream into a single structured result. The ONLY
 *  place that knows the event shape — everything downstream sees plain data. */
export async function collectCompletion(
  provider: ISauceBotProvider,
  req: CompletionRequest,
): Promise<CollectedCompletion> {
  let text = "";
  let reasoning = "";
  const toolUses: CollectedCompletion["toolUses"] = [];
  let inputTokens = 0;
  let outputTokens = 0;
  let doneReason: CollectedCompletion["doneReason"] = "unknown";
  let error: string | undefined;

  for await (const ev of provider.complete(req)) {
    switch (ev.type) {
      case "text":
        text += ev.delta;
        break;
      case "reasoning":
        reasoning += ev.delta;
        break;
      case "tool_use":
        toolUses.push({ id: ev.id, name: ev.name, input: ev.input });
        break;
      case "usage":
        inputTokens = ev.inputTokens;
        outputTokens = ev.outputTokens;
        break;
      case "done":
        doneReason = ev.reason;
        if (ev.error) error = ev.error;
        break;
      // "status" is a transient UI signal — ignored here.
    }
  }
  return error !== undefined
    ? { text, reasoning, toolUses, inputTokens, outputTokens, doneReason, error }
    : { text, reasoning, toolUses, inputTokens, outputTokens, doneReason };
}

/** Convenience: just the assembled answer text. */
export async function collectText(
  provider: ISauceBotProvider,
  req: CompletionRequest,
): Promise<string> {
  return (await collectCompletion(provider, req)).text;
}

export interface VerifiedOpts {
  /** Self-consistency samples (1 ⇒ single pass, no voting). */
  samples?: number;
  /** Optional critique-revise refinement of the voted winner. */
  critique?: Critic<string>;
  revise?: Reviser<string>;
  maxRounds?: number;
  /** Base temperature for the first sample. Default uses the request's. */
  baseTemp?: number;
  /** Temperature increment per sample so samples diverge (self-consistency
   *  needs variance). Default 0.15. */
  tempStep?: number;
}

/**
 * Run the verify stage over any provider: sample the model N times (with rising
 * temperature so samples genuinely differ), majority-vote, then optionally
 * critique-revise. Works on every endpoint because it only touches
 * `provider.complete()`.
 */
export async function runVerified(
  provider: ISauceBotProvider,
  req: CompletionRequest,
  opts: VerifiedOpts = {},
): Promise<VerifyResult<string>> {
  const baseTemp = opts.baseTemp ?? req.temperature ?? 0.4;
  const tempStep = opts.tempStep ?? 0.15;
  const generate = (attempt: number): Promise<string> =>
    collectText(provider, {
      ...req,
      // Vary temperature per attempt so the N samples aren't identical.
      temperature: attempt === 0 ? baseTemp : baseTemp + tempStep * attempt,
    });

  return verify<string>({
    generate,
    samples: opts.samples ?? 1,
    key: (v) => v.trim().toLowerCase(),
    ...(opts.critique ? { critique: opts.critique } : {}),
    ...(opts.revise ? { revise: opts.revise } : {}),
    ...(opts.maxRounds != null ? { maxRounds: opts.maxRounds } : {}),
  });
}

/**
 * Whether a transport supports server-side constrained decoding (json_schema
 * response_format). Used to decide between native structured output vs the
 * tool-call/repair fallback. Ollama lacks strict json_schema enforcement, so it
 * routes through the repair path instead.
 */
export function harnessSupportsStructuredOutput(
  harness: ProviderHarness,
): boolean {
  switch (harness) {
    case "openai-compat": // OpenAI, LM Studio REST, NIM, OpenRouter, Groq, Gemini-compat.
    case "lmstudio-sdk": // SDK structured output via zod/json-schema.
    case "anthropic": // tool-forced structured output.
      return true;
    case "ollama":
    case "claude-code": // CLI -p mode: no json_schema response_format.
      return false;
    default: {
      const _exhaustive: never = harness;
      return Boolean(_exhaustive);
    }
  }
}
