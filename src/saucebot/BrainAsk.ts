// Brain "Ask" structured contract + honesty guardrail.
//
// Ported from the sauce-brain prototype's ask.ts, but decoupled from the
// headless `claude -p` spawn: the answer now comes from the plugin's own
// SauceBotRuntime (whatever provider is configured — LM Studio / Anthropic /
// …). The schema and the load-bearing honesty rule are preserved verbatim:
//
//   NO CITATION ⇒ NO CLAIM. An answer with zero `path:line` citations is not an
//   answer; we surface an honest "I don't have that" instead of uncited prose.

export interface BrainAnswer {
  lead: string;
  who: { name: string; detail: string; status?: "cleared" | "confirm" | "early" }[];
  what: { title: string; detail: string; source: string }[];
  citations: string[];
}

/** Honesty guardrail: an uncited answer is replaced by this honest no-answer. */
export const NO_CITED_ANSWER: BrainAnswer = {
  lead: "I don't have a cited answer for that — nothing in the vault resolved with a path:line citation.",
  who: [],
  what: [],
  citations: [],
};

/** The WHO/WHAT/citation protocol the model must follow. Vault-relative paths
 *  only — never an absolute host path (leaks the operator's disk + breaks
 *  citations on any other machine). The model is handed candidate paths +
 *  inlined entity bodies by the runtime, so it cites against real content. */
export function brainSystemPrompt(): string {
  return `You answer questions against the current Operating Memory vault. Read-only. All paths are vault-relative — never emit an absolute host path.

Respond with a SINGLE JSON object and nothing else (no prose, no code fences) matching:
{
  "lead": string,                          // one-paragraph answer (<= 320 chars)
  "who": [{ "name": string, "detail": string, "status"?: "cleared"|"confirm"|"early" }],
  "what": [{ "title": string, "detail": string, "source": string }],
  "citations": [string]                    // vault-relative "path:line" references that exist in this vault
}

Rules:
1. WHO-YOU-KNOW: draw from people/, orgs/, lanes/, touches/. For "who do we know" questions only intro_opt_in: true people are "cleared"; others need a willingness check ("confirm"); cite the exact frontmatter fields that matched (expertise, title, company — never vibes); rank by closeness + last_touch recency; when the honest answer is nobody, say so in lead and return empty who.
2. WHAT-YOU-KNOW: draw from notes/, decisions/, playbooks/, sources/, ideas/, observations/.
3. EVERY claim must be backed by a citation in the citations array as a vault-relative path:line reference that exists in this vault. No citation ⇒ do not say it — answer "I don't have that" with an empty citations array instead.
4. Never modify any file.`;
}

/** Defensive parse ladder — shape drift degrades to the honest no-answer rather
 *  than throwing. Mirrors the prototype's parseAnswer, minus the CLI envelope
 *  layer (the runtime already returns plain assistant text). */
export function parseBrainAnswer(raw: string): BrainAnswer {
  const tryParse = (s: string): unknown => {
    try {
      return JSON.parse(s);
    } catch {
      return null;
    }
  };

  // Models often wrap JSON in prose or ```json fences — extract the first
  // balanced {...} block as a fallback before giving up.
  let candidate: unknown = tryParse(raw.trim());
  if (candidate == null) {
    const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced?.[1]) candidate = tryParse(fenced[1].trim());
  }
  if (candidate == null) {
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start !== -1 && end > start) candidate = tryParse(raw.slice(start, end + 1));
  }
  if (candidate == null || typeof candidate !== "object") return NO_CITED_ANSWER;

  const c = candidate as Record<string, unknown>;
  if (typeof c.lead !== "string") return NO_CITED_ANSWER;

  const arr = <T>(v: unknown, n: number): T[] => (Array.isArray(v) ? (v.slice(0, n) as T[]) : []);
  const citations = arr<unknown>(c.citations, 8)
    .map(String)
    .filter((s) => s.trim().length > 0);

  // No citation ⇒ no claim: never present an uncited lead as an answer.
  if (citations.length === 0) return NO_CITED_ANSWER;

  return {
    lead: c.lead.slice(0, 600),
    who: arr<{ name?: unknown }>(c.who, 4).filter(
      (w) => w && typeof w.name === "string",
    ) as BrainAnswer["who"],
    what: arr<{ title?: unknown }>(c.what, 4).filter(
      (w) => w && typeof w.title === "string",
    ) as BrainAnswer["what"],
    citations,
  };
}
