// SPEC §19.5 — Sessions saved under _addenda/_copilot/YYYY-MM-DD-<slug>.md.
import type { ChatMessage } from "./ISauceBotProvider";
import type { TurnTrace } from "./ChatTrace";

export interface SauceBotSession {
  id: string;
  /** Stable trace ids — populated so an entire chat chain can be replayed. */
  conversationId?: string;
  chatId?: string;
  installId?: string;
  agentId?: string;
  createdTs: number;
  updatedTs: number;
  model: string;
  provider: string;
  skillSet: string[];
  messages: ChatMessage[];
  /** Per-turn trace records (ids + model usage + fingerprints). */
  turns?: TurnTrace[];
  tokenIn: number;
  tokenOut: number;
}

export interface ConversationHost {
  readJson<T>(path: string): Promise<T | null>;
  writeMarkdown(
    path: string,
    frontmatter: Record<string, unknown>,
    body: string,
  ): Promise<void>;
  list(dir: string): Promise<string[]>;
}

function isoDate(ts: number): string {
  return new Date(ts).toISOString().slice(0, 10);
}
function slug(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 60) || "session"
  );
}

export class ConversationStore {
  constructor(
    private readonly host: ConversationHost,
    private readonly root = "_addenda/_copilot",
  ) {}

  pathFor(s: SauceBotSession, titleHint = ""): string {
    return `${this.root}/${isoDate(s.createdTs)}-${slug(titleHint || s.id)}.md`;
  }

  async save(s: SauceBotSession, titleHint = ""): Promise<string> {
    const path = this.pathFor(s, titleHint);
    const body = s.messages
      .map(
        (m) =>
          `### ${m.role}\n\n${typeof m.content === "string" ? m.content : JSON.stringify(m.content, null, 2)}\n`,
      )
      .join("\n");
    await this.host.writeMarkdown(
      path,
      {
        type: "copilot-session",
        session_id: s.id,
        // Replay-grade trace ids (every layer; never null in a live session).
        conversation_id: s.conversationId ?? s.id,
        chat_id: s.chatId ?? s.id,
        install_id: s.installId ?? "",
        agent_id: s.agentId ?? "",
        model: s.model,
        provider: s.provider,
        created: new Date(s.createdTs).toISOString(),
        updated: new Date(s.updatedTs).toISOString(),
        skills: s.skillSet,
        // Full per-turn trace (ids, usage, fingerprints) for support/replay.
        turns: (s.turns ?? []).map((t) => ({
          turn_id: t.turnId,
          response_id: t.responseId,
          index: t.index,
          ts: t.ts,
          agent_id: t.agentId,
          input_fp: t.inputFingerprint,
          output_fp: t.outputFingerprint,
          provider: t.usage.provider,
          model: t.usage.model,
          tokens_in: t.usage.inputTokens,
          tokens_out: t.usage.outputTokens,
          latency_ms: t.usage.latencyMs,
          reason: t.usage.reason ?? "",
          distilled: t.usage.distilled ?? false,
          tool_calls: t.usage.toolCalls ?? 0,
        })),
        tokens_in: s.tokenIn,
        tokens_out: s.tokenOut,
      },
      body,
    );
    return path;
  }
}
