// ─────────────────────────────────────────────────────────────────────────────
//  LM STUDIO CAPABILITY — single programmatic source of truth
// ─────────────────────────────────────────────────────────────────────────────
//
//  One module the picker, router, self-heal loop, and settings UI all READ FROM.
//  It pins three things our local-AI integration kept re-deriving ad-hoc:
//
//    1. THE API SURFACE  — every endpoint across LM Studio's native REST (`/api/v0`),
//       the OpenAI-compatible layer (`/v1`), and the `@lmstudio/sdk` JS library,
//       plus the OpenAI- and Anthropic-shaped provider schemas we route to. A
//       typed catalog, not prose, so tooling can enumerate it.
//
//    2. HOST FIT         — pure logic deciding whether a model will actually LOAD
//       on this user's machine (VRAM/size), so the picker can hide models that
//       would OOM instead of letting the user pick a doomed one. No false
//       negatives: when the host is unknown we never hide.
//
//    3. THE 3·6·9 HARNESS MATRIX — the canonical cross-code harness functions
//       (start/stop/retry/requeue, async vs sync) arranged as a snowflake:
//       3 domains × 3 lanes = 9 operations. The matrix is data; the wiring in
//       SauceBotRuntime/ModelLifecycle/EmbeddingsLane implements against it.
//
//  Companion shapes already live in ModelCatalog.ts (CatalogModel) and
//  ProviderRegistry.ts (providers). This module extends, never forks, them.

import type { CatalogModel } from "../ModelCatalog";

// ═══════════════════════════════════════════════════════════════════════════
//  PART A — API SURFACE (source-of-truth dump)
// ═══════════════════════════════════════════════════════════════════════════

export type ApiGroup =
  | "native-v0" // LM Studio's enhanced REST (model cards + per-call stats).
  | "openai-v1" // OpenAI-compatible layer (drop-in for OpenAI SDKs).
  | "anthropic" // Anthropic Messages shape (cloud route / future LM proxy).
  | "sdk"; // @lmstudio/sdk (lmstudio-js) — WebSocket, JIT load, .act() agents.

export interface ApiEndpoint {
  group: ApiGroup;
  /** HTTP verb, or "ws"/"call" for SDK surface entries. */
  method: "GET" | "POST" | "ws" | "call";
  /** Path (REST) or SDK member access path. */
  path: string;
  purpose: string;
  streaming?: boolean;
  /** Returns richer payloads than the OpenAI-compat equivalent. */
  enriched?: boolean;
}

/**
 * The full reachable surface. Ordered native → openai → anthropic → sdk so a
 * consumer can prefer the richest source and degrade gracefully (exactly the
 * fallback ModelCatalog.fetchLmStudio already encodes: try `/api/v0/models`,
 * fall back to `/v1/models`).
 */
export const LM_STUDIO_API_SURFACE: readonly ApiEndpoint[] = [
  // ── Native v0 — the model card + per-call token/timing stats ──────────────
  {
    group: "native-v0",
    method: "GET",
    path: "/api/v0/models",
    purpose:
      "List downloaded models WITH cards: type(llm|vlm|embeddings), arch, " +
      "state(loaded|not-loaded), max_context_length, quantization, publisher, capabilities.",
    enriched: true,
  },
  {
    group: "native-v0",
    method: "GET",
    path: "/api/v0/models/{model}",
    purpose: "Single model card by id.",
    enriched: true,
  },
  {
    group: "native-v0",
    method: "POST",
    path: "/api/v0/chat/completions",
    purpose: "Chat with per-response stats (tokens/sec, ttft, model state).",
    streaming: true,
    enriched: true,
  },
  {
    group: "native-v0",
    method: "POST",
    path: "/api/v0/completions",
    purpose: "Text completion with stats.",
    streaming: true,
    enriched: true,
  },
  {
    group: "native-v0",
    method: "POST",
    path: "/api/v0/embeddings",
    purpose: "Embeddings with stats.",
    enriched: true,
  },
  // ── OpenAI-compatible v1 — drop-in, ids-only model list ───────────────────
  {
    group: "openai-v1",
    method: "GET",
    path: "/v1/models",
    purpose: "List model ids (no cards). Fallback when /api/v0 absent.",
  },
  {
    group: "openai-v1",
    method: "POST",
    path: "/v1/chat/completions",
    purpose: "OpenAI-shaped chat (messages[], tools[], tool_choice).",
    streaming: true,
  },
  {
    group: "openai-v1",
    method: "POST",
    path: "/v1/completions",
    purpose: "OpenAI-shaped text completion.",
    streaming: true,
  },
  {
    group: "openai-v1",
    method: "POST",
    path: "/v1/embeddings",
    purpose: "OpenAI-shaped embeddings (input, model → data[].embedding).",
  },
  // ── Anthropic Messages shape — cloud route / content-block tool_use ───────
  {
    group: "anthropic",
    method: "POST",
    path: "/v1/messages",
    purpose:
      "Anthropic Messages: system, messages[] of content blocks, tools[], " +
      "tool_use / tool_result blocks, stream events.",
    streaming: true,
  },
  // ── @lmstudio/sdk — WebSocket, JIT load/unload, agentic .act() ────────────
  {
    group: "sdk",
    method: "ws",
    path: "new LMStudioClient({ baseUrl })",
    purpose: "WebSocket client (auth via clientIdentifier/passkey).",
  },
  {
    group: "sdk",
    method: "call",
    path: "client.llm.model(id) / .load(id) / .unload(id)",
    purpose: "JIT model lifecycle — load on demand, free VRAM on unload.",
  },
  {
    group: "sdk",
    method: "call",
    path: "client.llm.listLoaded() / listDownloaded()",
    purpose: "Loaded vs on-disk inventory (downloaded carries sizeBytes).",
    enriched: true,
  },
  {
    group: "sdk",
    method: "call",
    path: "model.respond() / .complete() / .act(tools)",
    purpose: "Chat, completion, and the agentic tool loop (.act).",
    streaming: true,
  },
  {
    group: "sdk",
    method: "call",
    path: "client.embedding.model(id).embed(text[])",
    purpose: "Batch embeddings via the SDK.",
  },
  {
    group: "sdk",
    method: "call",
    path: "model.getContextLength() / .getModelInfo()",
    purpose: "Authoritative context length + arch/quant for a loaded model.",
    enriched: true,
  },
] as const;

/**
 * Structured output (constrained decoding). LM Studio honors the OpenAI
 * `response_format: { type:"json_schema", json_schema:{ name, schema, strict } }`
 * on `/v1/chat/completions` and `/api/v0/chat/completions`, forcing grammar-
 * constrained generation so the model CANNOT emit malformed JSON. This is the
 * reliability upgrade that lets small local models drive structured pipelines.
 */
export interface JsonSchemaResponseFormat {
  type: "json_schema";
  json_schema: {
    name: string;
    schema: Record<string, unknown>;
    strict: boolean;
  };
}

/** Build a strict `response_format` envelope for constrained decoding. Pass the
 *  result straight into a chat-completions request body. */
export function jsonSchemaResponseFormat(
  name: string,
  schema: Record<string, unknown>,
): JsonSchemaResponseFormat {
  return { type: "json_schema", json_schema: { name, schema, strict: true } };
}

/** The provider schema families we normalize every chat turn into/out of. */
export const PROVIDER_SCHEMAS = {
  "openai-compat": {
    request: "{ model, messages[], temperature, max_tokens, stream, tools?, tool_choice? }",
    toolCall: "choices[].message.tool_calls[] = { id, function:{ name, arguments } }",
  },
  anthropic: {
    request: "{ model, system, messages[], max_tokens, stream, tools? }",
    toolCall: "content[] block { type:'tool_use', id, name, input }",
  },
} as const;

// ═══════════════════════════════════════════════════════════════════════════
//  PART B — CAPABILITY MODEL (extends the live CatalogModel with fit data)
// ═══════════════════════════════════════════════════════════════════════════

export interface CapabilityModel extends CatalogModel {
  /** Estimated parameter count in billions, parsed from the id when absent. */
  paramsB?: number;
  /** Quantization bits-per-param (4, 5, 6, 8, 16, 32) when derivable. */
  quantBits?: number;
}

/** A host's known compute envelope. Every field is optional — partial knowledge
 *  still improves gating, and total ignorance never hides a model. */
export interface HostEnvironment {
  totalVramBytes?: number;
  freeVramBytes?: number;
  totalRamBytes?: number;
  /** Largest model (bytes) we've actually seen LOAD on this host. Learned from
   *  knownGoodModels load history — the most reliable real-world ceiling. */
  learnedMaxLoadedBytes?: number;
}

export type Confidence = "low" | "medium" | "high";

export interface FitVerdict {
  fits: boolean;
  confidence: Confidence;
  /** Estimated footprint in bytes (0 ⇒ unknown). */
  estBytes: number;
  /** Terse (≤6 word) reason when it does not fit. */
  reason?: string;
}

// Bytes-per-parameter by quantization tag. Includes a runtime/KV-cache overhead
// factor so the estimate reflects load footprint, not just file size on disk.
const BYTES_PER_PARAM: Record<string, number> = {
  q2: 0.3,
  q3: 0.4,
  q4: 0.5,
  q5: 0.625,
  q6: 0.75,
  q8: 1.0,
  mxfp4: 0.55,
  bf16: 2.0,
  f16: 2.0,
  f32: 4.0,
};
const DEFAULT_BYTES_PER_PARAM = 0.6; // unknown quant ≈ q4/q5 band.
const RUNTIME_OVERHEAD = 1.2; // KV cache + context buffers.

/** Parse a billions-of-params count from a model id, e.g. "qwen3-30b" → 30,
 *  "lfm2-1.2b" → 1.2. Returns undefined when no `<n>b` token is present. */
export function parseParamsB(id: string): number | undefined {
  const m = id.toLowerCase().match(/(\d+(?:\.\d+)?)\s*b(?![a-z0-9])/);
  return m ? Number(m[1]) : undefined;
}

/** Parse quantization bits-per-param from a model id. */
export function parseQuantBytesPerParam(id: string): number {
  const s = id.toLowerCase();
  if (/mxfp4/.test(s)) return BYTES_PER_PARAM.mxfp4 ?? DEFAULT_BYTES_PER_PARAM;
  if (/bf16/.test(s)) return BYTES_PER_PARAM.bf16 ?? DEFAULT_BYTES_PER_PARAM;
  if (/f32|fp32/.test(s)) return BYTES_PER_PARAM.f32 ?? DEFAULT_BYTES_PER_PARAM;
  if (/f16|fp16/.test(s)) return BYTES_PER_PARAM.f16 ?? DEFAULT_BYTES_PER_PARAM;
  const q = s.match(/q(\d)/);
  if (q) return BYTES_PER_PARAM[`q${q[1]}`] ?? DEFAULT_BYTES_PER_PARAM;
  return DEFAULT_BYTES_PER_PARAM;
}

/**
 * Best estimate of a model's load footprint in bytes. Order of trust:
 *   1. an explicit sizeBytes (SDK listDownloaded / Ollama) — exact,
 *   2. params×quant heuristic parsed from the id — approximate,
 *   3. 0 (unknown) — caller treats as "don't hide".
 */
export function estimateModelBytes(model: CapabilityModel): number {
  if (typeof model.sizeBytes === "number" && model.sizeBytes > 0) {
    return model.sizeBytes;
  }
  const paramsB = model.paramsB ?? parseParamsB(model.id);
  if (paramsB === undefined) return 0;
  const bpp =
    model.quantBits != null
      ? model.quantBits / 8
      : parseQuantBytesPerParam(model.id);
  return Math.round(paramsB * 1e9 * bpp * RUNTIME_OVERHEAD);
}

function gb(bytes: number): string {
  return `${(bytes / 1e9).toFixed(bytes >= 1e10 ? 0 : 1)}GB`;
}

/**
 * Decide whether `model` will load on `host`. Conservative on the safe side:
 * an already-loaded model always fits; unknown size or unknown host never
 * hides (fits:true, low confidence). Only a KNOWN footprint over a KNOWN
 * budget returns fits:false.
 */
export function fitsHost(
  model: CapabilityModel,
  host: HostEnvironment,
): FitVerdict {
  const estBytes = estimateModelBytes(model);
  if (model.loaded) {
    return { fits: true, confidence: "high", estBytes };
  }
  // Budget = free VRAM, else 95% of total VRAM, else the learned real ceiling.
  const budget =
    host.freeVramBytes ??
    (host.totalVramBytes != null ? host.totalVramBytes * 0.95 : undefined) ??
    host.learnedMaxLoadedBytes;

  if (estBytes === 0) {
    // Unknown footprint — never hide; confidence reflects whether we know the host.
    return { fits: true, confidence: budget != null ? "medium" : "low", estBytes };
  }
  if (budget == null) {
    // Known footprint but unknown host — can't judge; don't hide.
    return { fits: true, confidence: "low", estBytes };
  }
  if (estBytes <= budget) {
    return {
      fits: true,
      confidence: host.freeVramBytes != null ? "high" : "medium",
      estBytes,
    };
  }
  return {
    fits: false,
    confidence: "high",
    estBytes,
    reason: `Needs ~${gb(estBytes)} VRAM`,
  };
}

export interface GateResult {
  /** Safe to show in the picker. */
  loadable: CapabilityModel[];
  /** Hidden — known to exceed the host's budget. */
  hidden: CapabilityModel[];
  /** Shown, but flagged low-confidence (host or size unknown). */
  uncertain: CapabilityModel[];
}

/**
 * Split a catalog into what the picker should show vs hide. The contract the UI
 * relies on: a model is hidden ONLY when we are confident it will not load.
 */
export function gateModels(
  models: CapabilityModel[],
  host: HostEnvironment,
): GateResult {
  const loadable: CapabilityModel[] = [];
  const hidden: CapabilityModel[] = [];
  const uncertain: CapabilityModel[] = [];
  for (const model of models) {
    const v = fitsHost(model, host);
    if (!v.fits) {
      hidden.push(model);
      continue;
    }
    loadable.push(model);
    if (v.confidence === "low") uncertain.push(model);
  }
  return { loadable, hidden, uncertain };
}

// ═══════════════════════════════════════════════════════════════════════════
//  PART C — 3·6·9 SNOWFLAKE HARNESS MATRIX
// ═══════════════════════════════════════════════════════════════════════════

export type HarnessDomain = "discover" | "lifecycle" | "infer";

export interface HarnessOp {
  domain: HarnessDomain;
  /** Canonical op name implemented somewhere in the runtime. */
  name: string;
  /** Predominant execution model. */
  mode: "async" | "sync";
  /** Bounded auto-retry on transient failure. */
  retry: boolean;
  /** Re-queue (defer + retry later) rather than fail hard. */
  requeue: boolean;
  /** Where the wiring lives. */
  impl: string;
  purpose: string;
}

/**
 * 3 domains × 3 lanes = 9 canonical operations. This is the "snowflake": the
 * hub is the runtime, each domain a primary arm, each op a leaf with its own
 * start/stop/retry/requeue characteristics. The runtime implements against
 * these names; this table is the contract + audit surface.
 */
export const HARNESS_MATRIX: readonly HarnessOp[] = [
  // Domain 1 — DISCOVER (find + classify what's reachable)
  {
    domain: "discover",
    name: "probeEndpoint",
    mode: "async",
    retry: true,
    requeue: true,
    impl: "detectLmStudioEndpoint.ts",
    purpose: "Find a reachable LM Studio endpoint (loopback → LAN sweep).",
  },
  {
    domain: "discover",
    name: "indexModels",
    mode: "async",
    retry: true,
    requeue: false,
    impl: "ModelCatalog.list()",
    purpose: "Enumerate models with cards; 30s cache; degrade v0→v1.",
  },
  {
    domain: "discover",
    name: "gateByHost",
    mode: "sync",
    retry: false,
    requeue: false,
    impl: "LMStudioCapability.gateModels()",
    purpose: "Hide models that won't load on this host's VRAM.",
  },
  // Domain 2 — LIFECYCLE (load/unload/keep-warm a model)
  {
    domain: "lifecycle",
    name: "loadModel",
    mode: "async",
    retry: true,
    requeue: true,
    impl: "ModelLifecycle.switchModel()",
    purpose: "JIT-load a model; classify+blocklist OOM/arch failures.",
  },
  {
    domain: "lifecycle",
    name: "unloadModel",
    mode: "async",
    retry: false,
    requeue: false,
    impl: "ModelLifecycle (unload prev)",
    purpose: "Free VRAM by unloading the prior model on switch.",
  },
  {
    domain: "lifecycle",
    name: "keepWarm",
    mode: "async",
    retry: true,
    requeue: true,
    impl: "SauceBotRuntime keepWarmTimer",
    purpose: "Re-warm on cadence so idle-TTL doesn't unload mid-session.",
  },
  // Domain 3 — INFER (chat / embed / agentic tools)
  {
    domain: "infer",
    name: "chat",
    mode: "async",
    retry: true,
    requeue: false,
    impl: "SauceBotRuntime.ask()",
    purpose: "Streamed chat with distill + history compaction + self-heal.",
  },
  {
    domain: "infer",
    name: "embed",
    mode: "async",
    retry: true,
    requeue: true,
    impl: "EmbeddingsLane / LMStudioEmbedService",
    purpose: "Realtime embeddings lane; warm+validate before select.",
  },
  {
    domain: "infer",
    name: "act",
    mode: "async",
    retry: true,
    requeue: false,
    impl: "ToolUseAdapter + toolRepairReask",
    purpose: "Agentic tool loop; re-ask once on malformed tool JSON.",
  },
] as const;

// ═══════════════════════════════════════════════════════════════════════════
//  PART C2 — QUALITY LATTICE (the multiplicative quality pipeline)
// ═══════════════════════════════════════════════════════════════════════════
//
//  Where HARNESS_MATRIX is the OPERATIONAL surface (discover/lifecycle/infer),
//  the lattice is the QUALITY surface: the ordered stages that turn a small
//  local model's raw output into a senior-assistant answer. Each stage kills one
//  failure mode; gains compound. Stages flagged `built:false` are the roadmap.

export type QualityStageId =
  | "socratic"
  | "context"
  | "decompose"
  | "route"
  | "constrain"
  | "generate"
  | "verify"
  | "ground"
  | "remember";

export interface QualityStage {
  id: QualityStageId;
  killsFailureMode: string;
  /** Rough quality multiplier on the dimension this stage targets. */
  multiplier: number;
  built: boolean;
  impl: string;
}

/** Ordered execution lattice. Socratic gate first (cheapest, prevents the worst
 *  failure: confidently answering a bad premise); Remember last (continuity). */
export const QUALITY_LATTICE: readonly QualityStage[] = [
  {
    id: "socratic",
    killsFailureMode: "confidently-wrong on a skewed assumption",
    multiplier: 1.3,
    built: true,
    impl: "harness/SocraticGate (heuristicAssess + assessAssumptions)",
  },
  {
    id: "context",
    killsFailureMode: "garbage-in (irrelevant/bloated context)",
    multiplier: 3.0,
    built: true,
    impl: "RagAssembler + Distiller + BrainCrystal",
  },
  {
    id: "decompose",
    killsFailureMode: "loses the thread on sprawling asks",
    multiplier: 2.5,
    built: true,
    impl: "harness/BlockOrchestrator (runBlocks — DAG + retry/skip)",
  },
  {
    id: "route",
    killsFailureMode: "wrong model for the task",
    multiplier: 1.8,
    built: true,
    impl: "gateModels in ProviderPicker (host-fit) + HostProbe learned ceiling",
  },
  {
    id: "constrain",
    killsFailureMode: "malformed/unparseable output",
    multiplier: 2.0,
    built: true,
    impl: "jsonSchemaResponseFormat (structured output)",
  },
  {
    id: "generate",
    killsFailureMode: "n/a (the base pass)",
    multiplier: 1.0,
    built: true,
    impl: "SauceBotRuntime.ask()",
  },
  {
    id: "verify",
    killsFailureMode: "unchecked one-shot errors / variance",
    multiplier: 2.5,
    built: true,
    impl: "harness/VerifyStage (selfConsistency + critiqueRevise)",
  },
  {
    id: "ground",
    killsFailureMode: "hallucination (ungrounded claims)",
    multiplier: 2.0,
    built: false,
    impl: "ToolUseAdapter + [[wikilink]] citations (roadmap)",
  },
  {
    id: "remember",
    killsFailureMode: "amnesia across sessions",
    multiplier: 1.2,
    built: true,
    impl: "harness/MemoryStore (upsert/recall/forget) + .sauceBrain/memory",
  },
] as const;

// ═══════════════════════════════════════════════════════════════════════════
//  PART D — TERSE UX COPY (≤10 words, mostly ≤6) + DEBUG
// ═══════════════════════════════════════════════════════════════════════════

/** Canonical short status/error strings. Hard cap: 10 words. Keep them telling
 *  the user where they're going, not what broke internally. */
export const TERSE = {
  // Lifecycle
  loading: "Loading model…",
  loaded: "Model ready",
  unloaded: "Model unloaded",
  switching: "Switching model…",
  warming: "Warming up…",
  // Inference
  thinking: "Thinking…",
  embedding: "Indexing notes…",
  ready: "Ready",
  // Connectivity
  connecting: "Connecting to LM Studio…",
  connected: "Connected",
  offline: "LM Studio offline. Start it, then retry.",
  // Failures (all carry a clear next action)
  failed: "That model failed. Try another.",
  oom: "Too big for your GPU. Pick smaller.",
  notFound: "Model not found. Refresh the list.",
  retry: "Hiccup. Tap to try again.",
  timeout: "Took too long. Try again.",
  noModels: "No models fit. Download a smaller one.",
} as const;

export type TerseKey = keyof typeof TERSE;

/** Look up a terse string; falls back to a humanized form of the key so a
 *  missing entry degrades to something readable rather than blank. */
export function terse(key: TerseKey | string): string {
  if (key in TERSE) return TERSE[key as TerseKey];
  return String(key).replace(/[-_]/g, " ").replace(/\s+/g, " ").trim();
}

/** Verbose debug toggle. The plugin reads `settings.debugMode`; this is the
 *  shared gate so every feature logs the SAME way when debugging is on. */
export interface DebugSink {
  enabled: boolean;
  log: (scope: string, msg: string, data?: unknown) => void;
}

export function makeDebugSink(
  enabled: boolean,
  out: (line: string, data?: unknown) => void = (l, d) =>
    d === undefined ? console.debug(l) : console.debug(l, d),
): DebugSink {
  return {
    enabled,
    log: (scope, msg, data) => {
      if (!enabled) return;
      out(`[saucebot:${scope}] ${msg}`, data);
    },
  };
}
