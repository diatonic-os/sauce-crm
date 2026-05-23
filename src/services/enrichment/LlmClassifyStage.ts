// LLM-backed classify stage for the enrichment pipeline (PLAN T5). Prompts the
// configured copilot model to pick a primary_type + roles from the vault's
// allowed enum vocabulary, then validates the response against that vocabulary
// (the model can only ever set values you've defined). Returns null on any
// failure so EnrichmentService falls back gracefully — no model, unreachable
// endpoint, or unparseable output all degrade to "no classification".

import type { EnrichmentInput, ClassifyResult, EnrichmentStages } from "../EnrichmentService";

export interface ClassifyVocab {
  primaryTypes: string[];
  roles: string[];
}

/** Single-shot completion: (system, user) → text, or null on failure. */
export type CompleteFn = (system: string, user: string) => Promise<string | null>;

const SYSTEM_PREAMBLE =
  "You classify a CRM contact from their notes. Respond with ONLY compact JSON, " +
  'no prose: {"primary_type": <one allowed value or null>, "roles": [<zero or more allowed values>]}. ' +
  "Choose only from the allowed lists; if unsure, use null / [].";

const BODY_CAP = 4000;

export function buildClassifyPrompt(input: EnrichmentInput, vocab: ClassifyVocab): { system: string; user: string } {
  const system =
    `${SYSTEM_PREAMBLE}\nAllowed primary_type: ${vocab.primaryTypes.join(", ") || "(none)"}` +
    `\nAllowed roles: ${vocab.roles.join(", ") || "(none)"}`;
  const name = String(input.frontmatter["name"] ?? input.frontmatter["title"] ?? input.path);
  const user = `Contact: ${name}\nEntity type: ${input.type}\n\nNotes:\n${input.body.slice(0, BODY_CAP)}`;
  return { system, user };
}

/** Parse + validate the model's JSON against the vocabulary. Tolerant of
 *  surrounding prose (extracts the first {...} block). Drops any value not in
 *  the allowed lists. */
export function parseClassifyResponse(text: string, vocab: ClassifyVocab): ClassifyResult | null {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  let obj: unknown;
  try {
    obj = JSON.parse(match[0]);
  } catch {
    return null;
  }
  if (!obj || typeof obj !== "object") return null;
  const rec = obj as Record<string, unknown>;

  const result: ClassifyResult = {};
  const pt = typeof rec.primary_type === "string" ? rec.primary_type.trim() : "";
  if (pt && vocab.primaryTypes.includes(pt)) result.primary_type = pt;

  const rolesRaw = Array.isArray(rec.roles) ? rec.roles : [];
  const roles = [...new Set(rolesRaw.map((r) => String(r).trim()).filter((r) => vocab.roles.includes(r)))];
  if (roles.length) result.roles = roles;

  return result.primary_type || result.roles ? result : null;
}

/** Build the classify stage. `vocab` is a getter so it reflects live settings. */
export function llmClassifyStage(complete: CompleteFn, vocab: () => ClassifyVocab): NonNullable<EnrichmentStages["classify"]> {
  return async (input) => {
    const v = vocab();
    if (!v.primaryTypes.length && !v.roles.length) return null; // nothing to classify into
    const { system, user } = buildClassifyPrompt(input, v);
    const text = await complete(system, user);
    if (!text) return null;
    return parseClassifyResponse(text, v);
  };
}
