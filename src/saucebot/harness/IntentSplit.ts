// ─────────────────────────────────────────────────────────────────────────────
//  SAUCEOM_HARNESS_DIRECTIVE @L1_input_analysis
//  Three-way intent split: the provider-independent quality lever.
//
//  Pipeline: normalize → segment → classify → extract → inferIntent → score
//
//  Pure module — no imports of obsidian or lancedb.
//  Types from L0Substrate may be imported but are not required here.
// ─────────────────────────────────────────────────────────────────────────────

// ═══════════════════════════════════════════════════════════════════════════
//  EXPORTED TYPES
// ═══════════════════════════════════════════════════════════════════════════

/** Socratic frame decomposing the input across the five analytical axes. */
export interface SocraticFrame {
  why: {
    goalInferred: string;
    motivationSignals: string[];
    conf: number;
  };
  what: {
    entities: string[];
    artifacts: string[];
    targetOutputType: string;
  };
  where: {
    scope: "file" | "vault" | "org" | "system" | "web";
    locus: string;
  };
  when: {
    urgency: "low" | "medium" | "high";
    temporalRefs: string[];
    schedulingNeeded: boolean;
  };
  how: {
    preferredMethod: string;
    constraints: string[];
    toneRequest: string;
  };
}

/** Three-way emotional / logical / execution intent split. */
export interface IntentSplit {
  emotional: {
    affect: string;
    need: "reassurance" | "speed" | "control" | "clarity";
    conf: number;
  };
  logical: {
    taskClass: string;
    successCriteria: string[];
    conf: number;
  };
  execution: {
    concreteActions: string[];
    toolsImplied: string[];
    conf: number;
  };
  /**
   * True when emotional.need is reassurance or control but execution has
   * concrete actions — a feeling-vs-doing mismatch the harness should surface.
   */
  divergenceFlag: boolean;
}

/** Full analysis result: frame + split + open questions. */
export interface AnalysisResult {
  frame: SocraticFrame;
  split: IntentSplit;
  /** Populated when any confidence score is below 0.4. */
  openQuestions: string[];
}

/**
 * Optional injected classifier — receives raw text and returns a partial
 * IntentSplit that is merged over the heuristic result.
 */
export type IntentClassifier = (text: string) => Promise<Partial<IntentSplit>>;

// ═══════════════════════════════════════════════════════════════════════════
//  INTERNAL CONSTANTS & HELPERS
// ═══════════════════════════════════════════════════════════════════════════

/** Regex to capture [[wikilinks]]. */
const WIKILINK_RE = /\[\[([^\]]+)\]\]/g;

/** Temporal words that signal urgency. */
const HIGH_URGENCY_WORDS = ["asap", "now", "today", "immediately", "urgent", "urgently"];
const MEDIUM_URGENCY_WORDS = ["soon", "shortly", "this week", "quickly", "promptly"];
/** Pattern for "by <timeref>" — e.g. "by Friday", "by 5pm", "by next week". */
const BY_DATE_RE = /\bby\s+(\w+(?:\s+\w+)?)\b/gi;

/** Common English sentence-start words that should not be treated as named entities. */
const COMMON_STOPWORDS = new Set([
  "the", "a", "an", "this", "that", "these", "those", "it", "is", "are",
  "was", "were", "be", "been", "being", "have", "has", "had", "do", "does",
  "did", "will", "would", "could", "should", "may", "might", "shall",
  "can", "need", "must", "let", "get", "got", "make", "made", "take",
  "took", "go", "went", "come", "came", "see", "saw", "know", "think",
  "i", "me", "my", "we", "our", "you", "your", "he", "she", "they",
  "his", "her", "their", "its", "in", "on", "at", "by", "for", "with",
  "about", "into", "from", "to", "of", "and", "or", "but", "if", "as",
  "so", "please", "just", "create", "add", "open", "show", "find",
  "list", "edit", "update", "delete", "remove", "write", "draft",
  "schedule", "plan", "finish", "complete", "fix", "check", "run",
  "there", "when", "where", "what", "who", "how", "why", "which",
  "all", "any", "some", "no", "not", "new", "old", "first", "last",
  "one", "two", "three", "then", "also", "only", "very", "much",
  "more", "most", "few", "little", "other", "each", "every", "both",
  "same", "such", "after", "before", "up", "down", "out", "over",
  "i'm", "i'll", "i've", "i'd", "it's", "don't", "can't", "won't",
  "umm", "uh", "hmm", "maybe", "dunno", "something", "anything",
]);

/** Confidence floor for surfacing open questions. */
const LOW_CONF_THRESHOLD = 0.4;

// ─────────────────────────────────────────────────────────────────────────────
//  STEP 1 — Normalize
// ─────────────────────────────────────────────────────────────────────────────

function normalize(text: string): string {
  return text.trim().replace(/\s+/g, " ");
}

// ─────────────────────────────────────────────────────────────────────────────
//  STEP 2 — Extract wikilinks and Capitalized Names as entities
// ─────────────────────────────────────────────────────────────────────────────

function extractEntities(text: string): string[] {
  const entities: string[] = [];
  const seen = new Set<string>();

  // Wikilinks first — highest signal
  const wikilinkMatches = text.matchAll(WIKILINK_RE);
  for (const m of wikilinkMatches) {
    const entity = (m[1] ?? "").trim();
    if (entity && !seen.has(entity)) {
      entities.push(entity);
      seen.add(entity);
    }
  }

  // Scrub wikilinks from text before scanning for Capitalized Names
  const stripped = text.replace(WIKILINK_RE, " ");

  // Capitalized Name sequences: consecutive Title-Case tokens not in stopwords
  // We look for sequences like "Alice Johnson", "Project Alpha", "Q2 Report"
  const tokens = stripped.split(/\b/);
  let sequence: string[] = [];

  const flush = (): void => {
    if (sequence.length >= 2) {
      const name = sequence.join(" ");
      if (!seen.has(name)) {
        entities.push(name);
        seen.add(name);
      }
    }
    sequence = [];
  };

  for (const token of tokens) {
    if (/^[A-Z][a-zA-Z0-9]*$/.test(token)) {
      const lower = token.toLowerCase();
      if (!COMMON_STOPWORDS.has(lower)) {
        sequence.push(token);
        continue;
      }
    }
    // token breaks the sequence
    if (!/^\s*$/.test(token)) {
      flush();
    }
  }
  flush();

  return entities;
}

// ─────────────────────────────────────────────────────────────────────────────
//  STEP 3 — Detect urgency
// ─────────────────────────────────────────────────────────────────────────────

interface UrgencyResult {
  urgency: "low" | "medium" | "high";
  temporalRefs: string[];
  schedulingNeeded: boolean;
}

function detectUrgency(text: string): UrgencyResult {
  const lower = text.toLowerCase();
  const temporalRefs: string[] = [];
  let urgency: "low" | "medium" | "high" = "low";

  // Check high-urgency words
  for (const word of HIGH_URGENCY_WORDS) {
    const re = new RegExp(`\\b${word}\\b`, "i");
    if (re.test(text)) {
      temporalRefs.push(word);
      urgency = "high";
    }
  }

  // Check medium-urgency words (only if not already high)
  for (const phrase of MEDIUM_URGENCY_WORDS) {
    if (lower.includes(phrase)) {
      temporalRefs.push(phrase);
      if (urgency === "low") urgency = "medium";
    }
  }

  // "by <timeref>" pattern → high urgency
  const byMatches = text.matchAll(BY_DATE_RE);
  for (const m of byMatches) {
    const fullMatch = m[0] ?? "";
    const ref = m[1] ?? "";
    // Exclude "by" used as preposition without a timeref (e.g. "by Alice")
    // Heuristic: if the following word looks like a day, date, or time-related word
    const isTimeRef =
      /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday|january|february|march|april|may|june|july|august|september|october|november|december|\d+(st|nd|rd|th)?|eod|eow|midnight|noon|morning|afternoon|evening|next|end)\b/i.test(
        ref,
      );
    if (isTimeRef) {
      temporalRefs.push(fullMatch.trim());
      urgency = "high";
    }
  }

  const schedulingNeeded =
    urgency !== "low" || lower.includes("schedule") || lower.includes("remind");

  return { urgency, temporalRefs, schedulingNeeded };
}

// ─────────────────────────────────────────────────────────────────────────────
//  STEP 4 — Infer targetOutputType
// ─────────────────────────────────────────────────────────────────────────────

type OutputType = "answer" | "list" | "draft" | "plan" | "edit";

function inferOutputType(text: string): OutputType {
  const lower = text.toLowerCase();

  // Plan signals
  if (/\b(plan|roadmap|outline|strategy|steps to|how to)\b/.test(lower)) return "plan";
  // List signals
  if (/\b(list|enumerate|show all|all the|every|items|tasks)\b/.test(lower)) return "list";
  // Draft/write/compose signals
  if (/\b(draft|write|compose|author|prepare)\b/.test(lower)) return "draft";
  // Edit signals
  if (/\b(edit|update|fix|correct|revise|change|modify|rewrite)\b/.test(lower)) return "edit";

  return "answer";
}

// ─────────────────────────────────────────────────────────────────────────────
//  STEP 5 — Infer scope
// ─────────────────────────────────────────────────────────────────────────────

function inferScope(text: string): "file" | "vault" | "org" | "system" | "web" {
  const lower = text.toLowerCase();
  if (/\b(web|internet|google|search online|url|http|website)\b/.test(lower)) return "web";
  if (/\b(system|os|terminal|shell|command|install|process)\b/.test(lower)) return "system";
  if (/\b(org|team|company|organization|department)\b/.test(lower)) return "org";
  if (/\b(vault|all notes?|all files?|every note|everywhere)\b/.test(lower)) return "vault";
  return "file";
}

// ─────────────────────────────────────────────────────────────────────────────
//  STEP 6 — Emotional intent classification
// ─────────────────────────────────────────────────────────────────────────────

interface EmotionalResult {
  affect: string;
  need: "reassurance" | "speed" | "control" | "clarity";
  conf: number;
}

function classifyEmotional(text: string): EmotionalResult {
  const lower = text.toLowerCase();

  // Reassurance signals
  if (
    /\b(worried|anxious|scared|afraid|concerned|nervous|fine|okay|alright|reassure|everything ok)\b/.test(
      lower,
    )
  ) {
    return { affect: "anxious", need: "reassurance", conf: 0.75 };
  }

  // Control signals
  if (
    /\b(control|exactly|precise|specific|must|make sure|ensure|in charge|manage)\b/.test(lower)
  ) {
    return { affect: "authoritative", need: "control", conf: 0.7 };
  }

  // Speed signals
  if (/\b(asap|quick|fast|hurry|rush|speed|rapid|immediately|urgent)\b/.test(lower)) {
    return { affect: "pressured", need: "speed", conf: 0.8 };
  }

  // Clarity signals (default for most informational requests)
  if (/\b(what|how|why|explain|clarify|understand|mean|define|confused)\b/.test(lower)) {
    return { affect: "curious", need: "clarity", conf: 0.65 };
  }

  // Vague / uncertain input
  if (/\b(umm|uh|hmm|maybe|dunno|something|not sure|i guess)\b/.test(lower)) {
    return { affect: "uncertain", need: "clarity", conf: 0.25 };
  }

  return { affect: "neutral", need: "clarity", conf: 0.55 };
}

// ─────────────────────────────────────────────────────────────────────────────
//  STEP 7 — Logical intent classification
// ─────────────────────────────────────────────────────────────────────────────

interface LogicalResult {
  taskClass: string;
  successCriteria: string[];
  conf: number;
}

function classifyLogical(text: string, outputType: OutputType): LogicalResult {
  const lower = text.toLowerCase();

  // Vague input
  if (/\b(umm|uh|dunno|maybe|something|not sure)\b/.test(lower)) {
    return { taskClass: "vague-intent", successCriteria: [], conf: 0.2 };
  }

  const taskClassMap: Record<string, string> = {
    plan: "planning",
    list: "enumeration",
    draft: "content-creation",
    edit: "content-modification",
    answer: "information-retrieval",
  };

  const taskClass = taskClassMap[outputType] ?? "information-retrieval";

  const successCriteria: string[] = [];
  if (/\b(create|add|new)\b/.test(lower)) successCriteria.push("artifact-created");
  if (/\b(find|show|list|get)\b/.test(lower)) successCriteria.push("result-returned");
  if (/\b(edit|update|fix|change)\b/.test(lower)) successCriteria.push("artifact-modified");
  if (successCriteria.length === 0) successCriteria.push("response-delivered");

  const conf = successCriteria.length > 0 ? 0.7 : 0.4;

  return { taskClass, successCriteria, conf };
}

// ─────────────────────────────────────────────────────────────────────────────
//  STEP 8 — Execution extraction
// ─────────────────────────────────────────────────────────────────────────────

interface ExecutionResult {
  concreteActions: string[];
  toolsImplied: string[];
  conf: number;
}

function extractExecution(text: string, entities: string[], outputType: OutputType): ExecutionResult {
  const lower = text.toLowerCase();
  const concreteActions: string[] = [];
  const toolsImplied: string[] = [];

  // Detect concrete action verbs
  const actionPatterns: Array<[RegExp, string]> = [
    [/\b(create|make|add|new)\b/, "create"],
    [/\b(edit|update|fix|modify|change|revise)\b/, "edit"],
    [/\b(delete|remove|trash)\b/, "delete"],
    [/\b(find|search|look up)\b/, "search"],
    [/\b(open|show|display|view)\b/, "open"],
    [/\b(list|enumerate)\b/, "list"],
    [/\b(write|draft|compose)\b/, "write"],
    [/\b(link|connect)\b/, "link"],
    [/\b(schedule|remind)\b/, "schedule"],
    [/\b(plan|outline)\b/, "plan"],
    [/\b(tell|say|confirm|verify|check|explain|describe)\b/, "inform"],
  ];

  for (const [re, action] of actionPatterns) {
    if (re.test(lower)) concreteActions.push(action);
  }

  // Infer tools from actions and entities
  if (concreteActions.includes("create") || concreteActions.includes("write")) {
    toolsImplied.push("vault_write");
  }
  if (concreteActions.includes("edit")) {
    toolsImplied.push("vault_edit");
  }
  if (concreteActions.includes("delete")) {
    toolsImplied.push("vault_delete");
  }
  if (concreteActions.includes("search") || concreteActions.includes("find")) {
    toolsImplied.push("vault_search");
  }
  if (concreteActions.includes("list")) {
    toolsImplied.push("vault_query");
  }
  if (concreteActions.includes("link")) {
    toolsImplied.push("vault_link");
  }
  if (concreteActions.includes("schedule")) {
    toolsImplied.push("calendar_tool");
  }

  // If we found [[wikilinks]], the vault is clearly implicated
  if (entities.length > 0 && toolsImplied.length === 0) {
    toolsImplied.push("vault_read");
  }

  const conf = concreteActions.length > 0 ? 0.75 : 0.3;
  return { concreteActions, toolsImplied, conf };
}

// ─────────────────────────────────────────────────────────────────────────────
//  STEP 9 — Goal inference
// ─────────────────────────────────────────────────────────────────────────────

function inferGoal(
  text: string,
  entities: string[],
  outputType: OutputType,
  taskClass: string,
): { goalInferred: string; motivationSignals: string[]; conf: number } {
  const lower = text.toLowerCase();
  const motivationSignals: string[] = [];

  if (/\b(because|so that|in order to|need to|want to)\b/.test(lower)) {
    motivationSignals.push("explicit-motivation");
  }
  if (entities.length > 0) motivationSignals.push("entity-anchored");
  if (/\b(project|task|goal|objective)\b/.test(lower)) motivationSignals.push("task-oriented");

  const goalInferred =
    entities.length > 0
      ? `${taskClass} involving ${entities.slice(0, 3).join(", ")}`
      : taskClass;

  const conf = motivationSignals.length >= 2 ? 0.7 : motivationSignals.length === 1 ? 0.5 : 0.3;

  return { goalInferred, motivationSignals, conf };
}

// ─────────────────────────────────────────────────────────────────────────────
//  STEP 10 — Tone detection
// ─────────────────────────────────────────────────────────────────────────────

function detectTone(text: string): string {
  const lower = text.toLowerCase();
  if (/\b(please|kindly|could you|would you)\b/.test(lower)) return "polite";
  if (/\b(must|need|require|now|immediately)\b/.test(lower)) return "imperative";
  if (/\b(maybe|perhaps|if possible|when you can)\b/.test(lower)) return "tentative";
  if (/\b(worried|scared|anxious|nervous)\b/.test(lower)) return "emotional";
  return "neutral";
}

// ─────────────────────────────────────────────────────────────────────────────
//  STEP 11 — Divergence detection
// ─────────────────────────────────────────────────────────────────────────────

function computeDivergence(emotional: EmotionalResult, execution: ExecutionResult): boolean {
  // Feeling vs doing mismatch: emotional need is reassurance or control,
  // but execution has concrete actions to perform.
  if (
    (emotional.need === "reassurance" || emotional.need === "control") &&
    execution.concreteActions.length > 0
  ) {
    return true;
  }
  return false;
}

// ─────────────────────────────────────────────────────────────────────────────
//  STEP 12 — Open questions (confidence-driven)
// ─────────────────────────────────────────────────────────────────────────────

function buildOpenQuestions(
  frame: SocraticFrame,
  split: IntentSplit,
): string[] {
  const questions: string[] = [];

  if (split.emotional.conf < LOW_CONF_THRESHOLD) {
    questions.push("What is the primary feeling or need behind this request?");
  }
  if (split.logical.conf < LOW_CONF_THRESHOLD) {
    questions.push("What specific outcome would make this request successful?");
  }
  if (split.execution.conf < LOW_CONF_THRESHOLD) {
    questions.push("What concrete action do you want taken?");
  }
  if (frame.why.conf < LOW_CONF_THRESHOLD) {
    questions.push("What is the underlying goal you are trying to achieve?");
  }

  return questions;
}

// ─────────────────────────────────────────────────────────────────────────────
//  STEP 13 — Artifacts extraction (file paths, URLs, tags)
// ─────────────────────────────────────────────────────────────────────────────

function extractArtifacts(text: string): string[] {
  const artifacts: string[] = [];
  // Hashtags as artifact/tag references
  const tagMatches = text.matchAll(/#([a-zA-Z][a-zA-Z0-9_-]*)/g);
  for (const m of tagMatches) {
    const tag = m[1];
    if (tag) artifacts.push(`#${tag}`);
  }
  // URL-like strings
  const urlMatches = text.matchAll(/https?:\/\/[^\s]+/g);
  for (const m of urlMatches) {
    if (m[0]) artifacts.push(m[0]);
  }
  return artifacts;
}

// ─────────────────────────────────────────────────────────────────────────────
//  STEP 14 — Locus inference (primary subject/file the action targets)
// ─────────────────────────────────────────────────────────────────────────────

function inferLocus(text: string, entities: string[]): string {
  // First wikilink is most likely the primary target
  const firstWikilink = WIKILINK_RE.exec(text);
  if (firstWikilink) {
    WIKILINK_RE.lastIndex = 0;
    return firstWikilink[1] ?? entities[0] ?? "current-context";
  }
  return entities[0] ?? "current-context";
}

// ═══════════════════════════════════════════════════════════════════════════
//  PUBLIC API
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Heuristic three-way intent analysis pipeline.
 *
 * Pipeline stages: normalize → segment → classify → extract → inferIntent → score
 *
 * @param text           Raw user input text.
 * @param contextSummary Optional vault/session context (used for disambiguation).
 * @returns              Full AnalysisResult with frame, split, and open questions.
 */
export function analyzeInput(text: string, contextSummary?: string): AnalysisResult {
  const normalized = normalize(text);
  const entities = extractEntities(normalized);
  const artifacts = extractArtifacts(normalized);
  const urgencyResult = detectUrgency(normalized);
  const outputType = inferOutputType(normalized);
  const scope = inferScope(normalized);
  const locus = inferLocus(normalized, entities);
  const tone = detectTone(normalized);
  const emotional = classifyEmotional(normalized);
  const logical = classifyLogical(normalized, outputType);
  const execution = extractExecution(normalized, entities, outputType);
  const goal = inferGoal(normalized, entities, outputType, logical.taskClass);
  const divergenceFlag = computeDivergence(emotional, execution);

  // Prefer method from context summary if available
  const preferredMethod =
    contextSummary && contextSummary.length > 0
      ? "context-aware-lookup"
      : execution.concreteActions[0] ?? "direct-response";

  const frame: SocraticFrame = {
    why: {
      goalInferred: goal.goalInferred,
      motivationSignals: goal.motivationSignals,
      conf: goal.conf,
    },
    what: {
      entities,
      artifacts,
      targetOutputType: outputType,
    },
    where: {
      scope,
      locus,
    },
    when: {
      urgency: urgencyResult.urgency,
      temporalRefs: urgencyResult.temporalRefs,
      schedulingNeeded: urgencyResult.schedulingNeeded,
    },
    how: {
      preferredMethod,
      constraints: [],
      toneRequest: tone,
    },
  };

  const split: IntentSplit = {
    emotional,
    logical,
    execution,
    divergenceFlag,
  };

  const openQuestions = buildOpenQuestions(frame, split);

  return { frame, split, openQuestions };
}

/**
 * AI-augmented intent analysis that merges classifier output over the heuristic
 * baseline. Falls back to pure heuristic when the classifier throws.
 *
 * @param text           Raw user input text.
 * @param classifier     Injected async intent classifier.
 * @param contextSummary Optional vault/session context.
 * @returns              Merged AnalysisResult.
 */
export async function analyzeInputAI(
  text: string,
  classifier: IntentClassifier,
  contextSummary?: string,
): Promise<AnalysisResult> {
  const heuristic = analyzeInput(text, contextSummary);

  let partial: Partial<IntentSplit> = {};
  try {
    partial = await classifier(text);
  } catch {
    // Classifier unavailable — return heuristic result unchanged.
    return heuristic;
  }

  // Deep-merge: each provided key from classifier overrides the heuristic field.
  const mergedSplit: IntentSplit = {
    emotional: partial.emotional ?? heuristic.split.emotional,
    logical: partial.logical ?? heuristic.split.logical,
    execution: partial.execution ?? heuristic.split.execution,
    // Recompute divergence from the merged emotional + execution
    divergenceFlag: computeDivergence(
      partial.emotional ?? heuristic.split.emotional,
      partial.execution ?? heuristic.split.execution,
    ),
  };

  const openQuestions = buildOpenQuestions(heuristic.frame, mergedSplit);

  return {
    frame: heuristic.frame,
    split: mergedSplit,
    openQuestions,
  };
}
