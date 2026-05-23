// LocalDeepVoter — same wire shape as LocalFastVoter but defaults to a
// larger local model (qwen3-coder-30b on LM Studio). Kept as a separate
// class so the council can tune weights & timeouts independently.

import type { Voter } from "../types";
import {
  LocalFastVoter,
  type LocalBackend,
  type LocalFastVoterConfig,
} from "./LocalFastVoter";

export interface LocalDeepVoterConfig extends LocalFastVoterConfig {
  // Reserved for future deep-mode-specific knobs (think_budget etc).
  thinkBudget?: number;
}

const DEFAULT_VOTER: Voter = {
  id: "voter.local.deep",
  name: "LocalDeep",
};

export class LocalDeepVoter extends LocalFastVoter {
  constructor(cfg: LocalDeepVoterConfig = {}) {
    const backend: LocalBackend = cfg.backend ?? "lmstudio";
    super({
      voter: cfg.voter ?? DEFAULT_VOTER,
      weight: cfg.weight ?? 2,
      backend,
      endpoint: cfg.endpoint,
      model:
        cfg.model ?? (backend === "lmstudio" ? "qwen3-coder-30b" : "qwen3:32b"),
      systemPrompt:
        cfg.systemPrompt ??
        [
          "You are a deep LSP-contract roundtable voter. Reason carefully.",
          'Reply with strict JSON: {"vote":"aye|nay|abstain","rationale":"<2-4 sentence justification>"}.',
          "No prose outside the JSON object.",
        ].join(" "),
    });
    void cfg.thinkBudget;
  }
}
