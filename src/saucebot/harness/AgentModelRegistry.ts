// ─────────────────────────────────────────────────────────────────────────────
//  AGENT MODEL REGISTRY — per-role model selection (SAUCEOM @providers.model_selection)
// ─────────────────────────────────────────────────────────────────────────────
//
//  Every runtime subagent (chat, planner, context-extraction, enrichment,
//  distill, verify, socratic, embed) shares ONE default model unless the user
//  assigns it a specific one in Settings. This is the directive's model_selection
//  made user-facing + the lmstudio-swarm philosophy: route cheap roles to a tiny
//  local model and reasoning roles to a bigger one — "smallest model that passes
//  the gate", per role.
//
//  PURE: a resolver over plain settings data. Every call site reads
//  resolveAgentModel(role, settings) so model routing lives in exactly one place.

/** The runtime subagent roles a user can independently configure. */
export type AgentRole =
  | "chat"
  | "planner"
  | "context_extraction"
  | "enrichment"
  | "distill"
  | "verify"
  | "socratic"
  | "embed";

export const AGENT_ROLES: readonly AgentRole[] = [
  "chat",
  "planner",
  "context_extraction",
  "enrichment",
  "distill",
  "verify",
  "socratic",
  "embed",
] as const;

/** Human labels + hints for the Settings UI (so each role explains itself). */
export const AGENT_ROLE_META: Record<AgentRole, { label: string; hint: string }> = {
  chat: { label: "Chat", hint: "Main conversational assistant" },
  planner: { label: "Planner", hint: "Proposes actions in the control loop" },
  context_extraction: {
    label: "Context extraction",
    hint: "Pulls structured context from touches / transcripts",
  },
  enrichment: { label: "Enrichment", hint: "Classifies / enriches contacts (cheap)" },
  distill: { label: "Distill", hint: "Compacts retrieved context (TOON)" },
  verify: { label: "Verify", hint: "Self-consistency + critique (reasoning)" },
  socratic: { label: "Socratic gate", hint: "Detects skew-risk assumptions" },
  embed: { label: "Embeddings", hint: "Vector indexing for RAG" },
};

export interface AgentModelConfig {
  provider?: string;
  model?: string;
  /** Route to the smallest local model that passes the task gate (lmstudio-swarm). */
  auto?: boolean;
}

export interface AgentModelDefaults {
  provider: string;
  model: string;
}

export interface AgentModelSettings {
  defaults: AgentModelDefaults;
  roles?: Partial<Record<AgentRole, AgentModelConfig>>;
}

export interface ResolvedAgentModel {
  role: AgentRole;
  provider: string;
  model: string;
  auto: boolean;
  /** "role" when any per-role override applied, else "default". */
  source: "role" | "default";
}

/**
 * Resolve the effective model for a role: a per-role override (each field
 * independently) layered over the global defaults. Unset roles fall straight
 * through to the chat default, so adding the feature changes nothing until a
 * user configures a role.
 */
export function resolveAgentModel(
  role: AgentRole,
  settings: AgentModelSettings,
): ResolvedAgentModel {
  const override = settings.roles?.[role];
  const hasOverride =
    override != null &&
    (override.provider != null ||
      override.model != null ||
      override.auto === true);
  return {
    role,
    provider: override?.provider ?? settings.defaults.provider,
    model: override?.model ?? settings.defaults.model,
    auto: override?.auto ?? false,
    source: hasOverride ? "role" : "default",
  };
}
