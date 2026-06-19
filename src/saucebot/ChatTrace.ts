// Chat trace metadata — the replay-grade record stamped for every turn.
//
// With an id at every layer (install → conversation → chat → turn → response →
// message) plus model usage, input/output fingerprints, agent id and a content
// signature, a support engineer can reconstruct and replay an entire user chat
// chain: which model answered, with what settings, how many tokens, how long,
// and whether the answer matches the recorded fingerprint. Non-repeatable ids
// make this safe across a multi-user / multi-install deployment.

import { newTurnId, newResponseId, fingerprint } from "./Ids";

export interface ModelUsage {
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  /** Provider done reason (end_turn / stop / error / max_tokens). */
  reason?: string;
  /** Whether context distillation ran for this turn. */
  distilled?: boolean;
  /** Number of tool calls executed this turn. */
  toolCalls?: number;
}

export interface TurnTrace {
  /** Layer ids — none are ever null. */
  turnId: string;
  responseId: string;
  conversationId: string;
  chatId: string;
  installId: string;
  agentId: string;
  /** Auto-incremented turn index within the conversation (0-based). */
  index: number;
  ts: number;
  /** Content fingerprints for replay verification. */
  inputFingerprint: string;
  outputFingerprint: string;
  usage: ModelUsage;
}

export interface TurnContext {
  conversationId: string;
  chatId: string;
  installId: string;
  agentId: string;
  index: number;
}

/**
 * Assemble a fully-populated TurnTrace. Generates fresh turn + response ids,
 * fingerprints the input and output, and carries the layer ids + usage. Every
 * field is populated — there are no nulls.
 */
export async function buildTurnTrace(
  ctx: TurnContext,
  input: string,
  output: string,
  usage: ModelUsage,
  now: number = Date.now(),
): Promise<TurnTrace> {
  const [inputFingerprint, outputFingerprint] = await Promise.all([
    fingerprint(input),
    fingerprint(output),
  ]);
  return {
    turnId: newTurnId(),
    responseId: newResponseId(),
    conversationId: ctx.conversationId,
    chatId: ctx.chatId,
    installId: ctx.installId,
    agentId: ctx.agentId,
    index: ctx.index,
    ts: now,
    inputFingerprint,
    outputFingerprint,
    usage,
  };
}
