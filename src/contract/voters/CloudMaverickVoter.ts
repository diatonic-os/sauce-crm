// CloudMaverickVoter — calls NVIDIA NIM
// (https://integrate.api.nvidia.com/v1/chat/completions) using a Bearer
// token retrieved from a KeyVault-like store at vote() time. The voter
// never caches the secret; KeyVault is the single source of truth.

import { requestUrl } from "obsidian";
import type { RoundtableProposal, Voter } from "../types";
import {
  coerceVote,
  parseJsonWithProseTolerance,
  type VoterAgent,
  type VoterContext,
  type VoterDecision,
} from "./types";
import { buildUserMessage } from "./LocalFastVoter";

/**
 * Minimal contract this voter needs from KeyVault. Declared locally so
 * the voter is decoupled from the concrete KeyVault implementation and
 * easy to mock in tests.
 */
export interface SecretSource {
  get(service: string): Promise<string>;
}

export interface CloudMaverickVoterConfig {
  vault: SecretSource;
  // KeyVault service id holding the NIM API key. Default: 'nvidia.nim'.
  secretService?: string;
  voter?: Voter;
  weight?: number;
  endpoint?: string;
  model?: string;
  systemPrompt?: string;
}

const DEFAULT_VOTER: Voter = {
  id: "voter.cloud.maverick",
  name: "CloudMaverick",
};

const DEFAULT_SYS = [
  "You are a maverick LSP-contract roundtable voter.",
  "Push back on weak invariants; reward clear contracts.",
  'Reply with strict JSON: {"vote":"aye|nay|abstain","rationale":"<short>"}.',
  "No prose outside the JSON object.",
].join(" ");

interface CloudResponse {
  vote: unknown;
  rationale?: unknown;
}

interface ObsidianResp {
  status: number;
  text: string;
  json: unknown;
}

export class CloudMaverickVoter implements VoterAgent {
  readonly voter: Voter;
  readonly weight: number;
  private readonly vault: SecretSource;
  private readonly secretService: string;
  private readonly endpoint: string;
  private readonly model: string;
  private readonly sys: string;

  constructor(cfg: CloudMaverickVoterConfig) {
    this.vault = cfg.vault;
    this.secretService = cfg.secretService ?? "nvidia.nim";
    this.voter = cfg.voter ?? DEFAULT_VOTER;
    this.weight = cfg.weight ?? 2;
    this.endpoint =
      cfg.endpoint ?? "https://integrate.api.nvidia.com/v1/chat/completions";
    this.model = cfg.model ?? "meta/llama-3.1-70b-instruct";
    this.sys = cfg.systemPrompt ?? DEFAULT_SYS;
  }

  async vote(
    proposal: RoundtableProposal,
    ctx: VoterContext,
  ): Promise<VoterDecision> {
    const start = Date.now();
    let token: string;
    try {
      token = await this.vault.get(this.secretService);
    } catch (err) {
      return {
        voter: this.voter,
        vote: "abstain",
        rationale: `secret unavailable: ${err instanceof Error ? err.message : String(err)}`,
        latencyMs: Date.now() - start,
      };
    }
    if (!token) {
      return {
        voter: this.voter,
        vote: "abstain",
        rationale: "secret empty",
        latencyMs: Date.now() - start,
      };
    }

    const body = {
      model: this.model,
      messages: [
        { role: "system", content: this.sys },
        { role: "user", content: buildUserMessage(proposal, ctx) },
      ],
      temperature: 0,
      stream: false,
    };

    try {
      const res = await requestUrl({
        url: this.endpoint,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
      } as unknown as Parameters<typeof requestUrl>[0]);

      const r = res as ObsidianResp;
      if (r.status >= 400) {
        return {
          voter: this.voter,
          vote: "abstain",
          rationale: `HTTP ${r.status}: ${truncate(r.text)}`,
          latencyMs: Date.now() - start,
        };
      }
      const text = extractCloudText(r);
      const parsed = parseJsonWithProseTolerance(text) as CloudResponse | null;
      if (!parsed) {
        return {
          voter: this.voter,
          vote: "abstain",
          rationale: `unparseable: ${truncate(text)}`,
          latencyMs: Date.now() - start,
        };
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
      return {
        voter: this.voter,
        vote: "abstain",
        rationale: `request failed: ${err instanceof Error ? err.message : String(err)}`,
        latencyMs: Date.now() - start,
      };
    }
  }
}

function extractCloudText(r: ObsidianResp): string {
  const j = r.json as Record<string, unknown> | null;
  if (j && typeof j === "object") {
    const choices = j.choices as Array<{ message?: { content?: unknown } }> | undefined;
    const c = choices?.[0]?.message?.content;
    if (typeof c === "string") return c;
  }
  return r.text ?? "";
}

function truncate(s: string): string {
  return s.length > 200 ? s.slice(0, 200) + "…" : s;
}
