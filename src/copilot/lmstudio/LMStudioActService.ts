// SPEC §19.4 — Agentic flows. Wraps SDK .act() with a V2-Skill bridge.

import type { LMStudioClientLike, LMStudioActOpts } from './LMStudioClientFactory';

export interface ToolSpec {
  name: string;
  description: string;
  parameters: Record<string, unknown>;   // JSON schema
  invoke(args: Record<string, unknown>): Promise<unknown>;
}

export interface ActRequest {
  modelId: string;
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
  tools: ToolSpec[];
  maxParallelToolCalls?: number;
  approveToolCall?: (toolName: string, args: Record<string, unknown>) => boolean | Promise<boolean>;
  onMessage?: (msg: unknown) => void;
  signal?: AbortSignal;
}

export interface ActResult {
  rounds: number;
  toolCalls: Array<{ name: string; args: Record<string, unknown>; result?: unknown; error?: string }>;
  finalMessage: string;
}

export class LMStudioActService {
  constructor(private readonly client: LMStudioClientLike, private readonly sdkExports: { tool: (def: unknown) => unknown }) {}

  async act(req: ActRequest): Promise<ActResult> {
    const model = await this.client.llm.model(req.modelId);
    if (!model.act) throw new Error('LM Studio model does not expose .act() — upgrade @lmstudio/sdk');

    const calls: ActResult['toolCalls'] = [];
    const sdkTools = req.tools.map((t) => this.sdkExports.tool({
      name: t.name,
      description: t.description,
      parameters: t.parameters,
      implementation: async (args: Record<string, unknown>) => {
        try {
          const result = await t.invoke(args);
          calls.push({ name: t.name, args, result });
          return result;
        } catch (e) {
          const err = e instanceof Error ? e.message : String(e);
          calls.push({ name: t.name, args, error: err });
          throw e;
        }
      },
    }));

    let finalMessage = '';
    const opts: LMStudioActOpts = {
      maxParallelToolCallCount: req.maxParallelToolCalls ?? 1,
      signal: req.signal,
      onMessage: (m) => {
        if (req.onMessage) req.onMessage(m);
        if (m && typeof m === 'object' && 'getText' in m) {
          try { finalMessage = (m as { getText: () => string }).getText(); } catch { /* */ }
        }
      },
      guardToolCall: req.approveToolCall ? async (_round, _id, ctx) => {
        const ok = await req.approveToolCall!(ctx.toolCallRequest.name, ctx.toolCallRequest.arguments);
        if (ok) ctx.allow(); else ctx.deny('Denied by user policy');
      } : undefined,
    };

    const result = await model.act(req.messages.map((m) => ({ role: m.role, content: m.content })), sdkTools, opts);
    return { rounds: result.rounds?.length ?? 1, toolCalls: calls, finalMessage };
  }
}
