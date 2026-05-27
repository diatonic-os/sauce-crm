// LocalFastVoter — small, fast local model. Targets Ollama by default
// (http://127.0.0.1:11434/api/generate) but speaks the LM Studio
// OpenAI-compatible /v1/chat/completions shape when configured.

import { requestUrl, type RequestUrlParam } from "obsidian";
import type { RoundtableProposal, Voter } from "../types";
import {
  coerceVote,
  parseJsonWithProseTolerance,
  type VoterAgent,
  type VoterContext,
  type VoterDecision,
} from "./types";

export type LocalBackend = "ollama" | "lmstudio";

export interface LocalFastVoterConfig {
  voter?: Voter;
  weight?: number;
  backend?: LocalBackend;
  endpoint?: string; // overrides backend default
  model?: string;
  systemPrompt?: string;
}

const DEFAULT_VOTER: Voter = {
  id: "voter.local.fast",
  name: "LocalFast",
};

const DEFAULT_SYS = [
  "You are a fast LSP-contract roundtable voter.",
  'Reply with strict JSON: {"vote":"aye|nay|abstain","rationale":"<short>"}.',
  "No prose outside the JSON object.",
].join(" ");

interface LocalResponse {
  vote: unknown;
  rationale?: unknown;
}

export class LocalFastVoter implements VoterAgent {
  readonly voter: Voter;
  readonly weight: number;
  private readonly backend: LocalBackend;
  private readonly endpoint: string;
  private readonly model: string;
  private readonly sys: string;

  constructor(cfg: LocalFastVoterConfig = {}) {
    this.voter = cfg.voter ?? DEFAULT_VOTER;
    this.weight = cfg.weight ?? 1;
    this.backend = cfg.backend ?? "ollama";
    this.endpoint =
      cfg.endpoint ??
      (this.backend === "ollama"
        ? "http://127.0.0.1:11434/api/generate"
        : "http://127.0.0.1:1234/v1/chat/completions");
    this.model =
      cfg.model ??
      (this.backend === "ollama"
        ? "qwen2.5:3b"
        : "lmstudio-community/Qwen2.5-3B-Instruct");
    this.sys = cfg.systemPrompt ?? DEFAULT_SYS;
  }

  async vote(
    proposal: RoundtableProposal,
    ctx: VoterContext,
  ): Promise<VoterDecision> {
    const start = Date.now();
    const userMsg = buildUserMessage(proposal, ctx);
    try {
      const body =
        this.backend === "ollama"
          ? {
              model: this.model,
              prompt: `${this.sys}\n\n${userMsg}`,
              stream: false,
            }
          : {
              model: this.model,
              messages: [
                { role: "system", content: this.sys },
                { role: "user", content: userMsg },
              ],
              stream: false,
              temperature: 0,
            };
      const req: RequestUrlParam = {
        url: this.endpoint,
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      };
      const res = await requestUrl(req);

      const text = extractText(res, this.backend);
      const parsed = parseJsonWithProseTolerance(text) as LocalResponse | null;
      if (!parsed) {
        return abstain(
          this.voter,
          `unparseable response: ${truncate(text)}`,
          start,
        );
      }
      const v = coerceVote(parsed.vote);
      const rationale =
        typeof parsed.rationale === "string" && parsed.rationale.length
          ? parsed.rationale
          : `vote=${v} (no rationale)`;
      return {
        voter: this.voter,
        vote: v,
        rationale,
        latencyMs: Date.now() - start,
      };
    } catch (err) {
      return abstain(
        this.voter,
        `request failed: ${err instanceof Error ? err.message : String(err)}`,
        start,
      );
    }
  }
}

export function buildUserMessage(
  proposal: RoundtableProposal,
  ctx: VoterContext,
): string {
  const parts: string[] = [
    `Proposal id: ${proposal.id}`,
    `Session: ${proposal.sessionId}`,
    `Proposal:\n${proposal.proposal}`,
  ];
  if (ctx.diff) parts.push(`Diff:\n${ctx.diff}`);
  if (ctx.metadata) parts.push(`Metadata:\n${JSON.stringify(ctx.metadata)}`);
  parts.push("Reply JSON only.");
  return parts.join("\n\n");
}

interface ObsidianResp {
  status: number;
  text: string;
  json: unknown;
}

export function extractText(res: unknown, backend: LocalBackend): string {
  const r = res as ObsidianResp;
  const j = r.json as Record<string, unknown> | null;
  if (j && typeof j === "object") {
    if (backend === "ollama" && typeof j.response === "string")
      return j.response;
    if (backend === "lmstudio") {
      const choices = j.choices as
        | Array<{ message?: { content?: unknown } }>
        | undefined;
      const c = choices?.[0]?.message?.content;
      if (typeof c === "string") return c;
    }
  }
  return r.text ?? "";
}

function abstain(
  voter: Voter,
  rationale: string,
  start: number,
): VoterDecision {
  return { voter, vote: "abstain", rationale, latencyMs: Date.now() - start };
}

function truncate(s: string): string {
  return s.length > 200 ? s.slice(0, 200) + "…" : s;
}
