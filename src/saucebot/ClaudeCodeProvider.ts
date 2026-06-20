// ─────────────────────────────────────────────────────────────────────────────
//  CLAUDE CODE PROVIDER — use the local Claude Code OAuth session as the model
// ─────────────────────────────────────────────────────────────────────────────
//
//  Routes SauceBot's chat through the locally-installed `claude` CLI (Claude
//  Code) in non-interactive `-p` mode. The CLI authenticates with the user's
//  Claude.ai OAuth login (~/.claude/.credentials.json) — so this uses the user's
//  Claude subscription, NOT a metered API key/token. No key entry needed.
//
//  DESKTOP-ONLY: spawns a child process. child_process is imported dynamically
//  (mobile builds never load it); on mobile complete() yields a clear error.
//
//  Output parsing (`claude -p --output-format json` → {result, usage, ...}) is a
//  pure, tested function; the spawn is a thin wrapper around it.

import type {
  ISauceBotProvider,
  CompletionEvent,
  CompletionRequest,
  ProviderCapabilities,
  ModelDescriptor,
} from "./ISauceBotProvider";

export interface ClaudeResult {
  ok: boolean;
  text: string;
  inputTokens: number;
  outputTokens: number;
  stopReason: string;
  error?: string;
}

/**
 * Parse `claude -p --output-format json` stdout. Tolerant of leading log lines
 * (scans for the first `{`). Never throws — malformed output → ok:false.
 */
export function parseClaudeResult(stdout: string): ClaudeResult {
  const fail = (error: string): ClaudeResult => ({
    ok: false,
    text: "",
    inputTokens: 0,
    outputTokens: 0,
    stopReason: "error",
    error,
  });
  const start = stdout.indexOf("{");
  if (start < 0) return fail(`no JSON in claude output: ${stdout.slice(0, 120)}`);
  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(stdout.slice(start)) as Record<string, unknown>;
  } catch (e) {
    return fail(e instanceof Error ? e.message : "claude output parse error");
  }
  const result = typeof obj.result === "string" ? obj.result : "";
  if (obj.is_error === true) {
    return fail(result || "claude reported an error");
  }
  const usage = (obj.usage ?? {}) as {
    input_tokens?: number;
    output_tokens?: number;
  };
  return {
    ok: true,
    text: result,
    inputTokens: usage.input_tokens ?? 0,
    outputTokens: usage.output_tokens ?? 0,
    stopReason: typeof obj.stop_reason === "string" ? obj.stop_reason : "end_turn",
  };
}

/**
 * Candidate paths/commands for the `claude` binary, per OS. On Windows npm
 * installs `claude.cmd`; we also probe common install dirs. `claude` alone works
 * when it's on PATH (and, with shell:true on Windows, resolves `claude.cmd`).
 */
export function claudeBinCandidates(
  platform: string,
  env: Record<string, string | undefined>,
  home: string,
): string[] {
  if (platform === "win32") {
    const appdata = env.APPDATA ?? "";
    const local = env.LOCALAPPDATA ?? "";
    return [
      "claude.cmd",
      "claude.exe",
      "claude",
      appdata ? `${appdata}\\npm\\claude.cmd` : "",
      local ? `${local}\\Programs\\claude\\claude.exe` : "",
      `${home}\\.local\\bin\\claude.exe`,
      `${home}\\AppData\\Roaming\\npm\\claude.cmd`,
    ].filter(Boolean);
  }
  // macOS / Linux
  return [
    "claude",
    `${home}/.local/bin/claude`,
    "/usr/local/bin/claude",
    "/opt/homebrew/bin/claude",
    "/usr/bin/claude",
  ];
}

export interface ClaudeDetection {
  found: boolean;
  binPath?: string;
  authed: boolean;
  models: ModelDescriptor[];
  error?: string;
}

/** Static Claude models exposed when the CLI is present (no /models endpoint). */
export const CLAUDE_CODE_MODELS: ModelDescriptor[] = [
  { id: "claude-opus-4-8", label: "Claude Opus 4.8", contextTokens: 200_000 },
  { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6", contextTokens: 200_000 },
  { id: "claude-haiku-4-5", label: "Claude Haiku 4.5", contextTokens: 200_000 },
];

export interface DetectOpts {
  runner?: (
    bin: string,
    args: string[],
    input: string,
  ) => Promise<{ stdout: string; stderr: string; code: number }>;
  platform?: string;
  env?: Record<string, string | undefined>;
  home?: string;
}

/**
 * Auto-detect Claude Code across platforms: find the binary, then verify the
 * local OAuth login works by parsing a tiny `-p` call. Returns the resolved bin
 * path, auth state, and the available models. Desktop-only (runs the binary).
 */
export async function detectClaudeCode(
  opts: DetectOpts = {},
): Promise<ClaudeDetection> {
  const none: ClaudeDetection = { found: false, authed: false, models: [] };
  const runner = opts.runner ?? (await makeDefaultRunner());
  if (!runner)
    return { ...none, error: "Claude Code detection is desktop-only." };
  const platform = opts.platform ?? process.platform;
  const env = opts.env ?? process.env;
  const home = opts.home ?? env.HOME ?? env.USERPROFILE ?? "";
  const candidates = claudeBinCandidates(platform, env, home);

  for (const bin of candidates) {
    try {
      const v = await runner(bin, ["--version"], "");
      if (v.code !== 0) continue;
      // Found a working binary — now verify OAuth auth with a 1-token call.
      let authed = false;
      try {
        const probe = await runner(
          bin,
          ["-p", "--output-format", "json", "--model", "claude-haiku-4-5"],
          "ok",
        );
        authed = parseClaudeResult(probe.stdout).ok;
      } catch {
        /* binary present but auth probe failed → found, not authed */
      }
      return { found: true, binPath: bin, authed, models: CLAUDE_CODE_MODELS };
    } catch {
      /* try next candidate */
    }
  }
  return { ...none, error: "claude CLI not found. Install Claude Code." };
}

/** Build the argv for a one-shot `claude -p` call. Pure (testable). */
export function buildClaudeArgs(req: CompletionRequest): string[] {
  const args = ["-p", "--output-format", "json"];
  if (req.model) args.push("--model", req.model);
  if (req.systemPrompt) args.push("--append-system-prompt", req.systemPrompt);
  return args;
}

/** Flatten the request messages into a single prompt for `-p` mode. */
function promptFromMessages(req: CompletionRequest): string {
  return req.messages
    .map((m) => {
      const text =
        typeof m.content === "string"
          ? m.content
          : m.content.map((b) => ("text" in b ? String(b.text) : "")).join("");
      return `${m.role}: ${text}`;
    })
    .join("\n\n");
}

export interface ClaudeCodeOptions {
  /** Path to the claude binary. Default: resolve from PATH ("claude"). */
  binPath?: string;
  /** Spawn seam for tests — defaults to child_process.spawn at runtime. */
  runner?: (
    bin: string,
    args: string[],
    input: string,
  ) => Promise<{ stdout: string; stderr: string; code: number }>;
}

/**
 * ISauceBotProvider backed by the local Claude Code CLI + OAuth. Streaming is
 * not used (json mode is one-shot); the runtime's non-streamed path consumes the
 * single text + usage + done events. Embeddings are unsupported (route RAG embed
 * to a local model).
 */
export class ClaudeCodeProvider implements ISauceBotProvider {
  readonly name = "claude-code";
  readonly models: ModelDescriptor[] = [];

  constructor(private readonly opts: ClaudeCodeOptions = {}) {}

  capabilities(): ProviderCapabilities {
    return { toolUse: false, streaming: false, vision: false, maxContext: 200_000 };
  }

  async *complete(req: CompletionRequest): AsyncIterable<CompletionEvent> {
    const runner = this.opts.runner ?? (await this.defaultRunner());
    if (!runner) {
      yield {
        type: "done",
        reason: "error",
        error:
          "Claude Code provider is desktop-only (needs the local `claude` CLI).",
      };
      return;
    }
    yield { type: "status", state: "loading", detail: req.model || "claude-code" };
    let res: { stdout: string; stderr: string; code: number };
    try {
      res = await runner(
        this.opts.binPath ?? "claude",
        buildClaudeArgs(req),
        promptFromMessages(req),
      );
    } catch (e) {
      yield {
        type: "done",
        reason: "error",
        error: `claude CLI failed to start: ${e instanceof Error ? e.message : String(e)}`,
      };
      return;
    }
    const parsed = parseClaudeResult(res.stdout);
    if (!parsed.ok) {
      yield {
        type: "done",
        reason: "error",
        error: parsed.error ?? res.stderr ?? "claude returned an error",
      };
      return;
    }
    if (parsed.text) yield { type: "text", delta: parsed.text };
    yield {
      type: "usage",
      inputTokens: parsed.inputTokens,
      outputTokens: parsed.outputTokens,
    };
    yield { type: "done", reason: "end_turn" };
  }

  // Claude Code has no embeddings endpoint — callers should use a local embed
  // provider (LM Studio / Ollama) for RAG.
  embed(): Promise<Float32Array> {
    return Promise.reject(
      new Error("claude-code provider does not support embeddings"),
    );
  }

  /** Lazily build the real child_process runner (desktop only). */
  private defaultRunner(): Promise<ClaudeCodeOptions["runner"] | null> {
    return makeDefaultRunner();
  }
}

type Runner = (
  bin: string,
  args: string[],
  input: string,
) => Promise<{ stdout: string; stderr: string; code: number }>;

/**
 * The real child_process-backed runner (desktop only; null on mobile). Uses
 * `shell:true` on Windows so `claude` resolves the npm-installed `claude.cmd`.
 */
export async function makeDefaultRunner(): Promise<Runner | null> {
  try {
    const cp = await import("child_process");
    const useShell = process.platform === "win32";
    return (bin, args, input) =>
      new Promise((resolve, reject) => {
        const child = cp.spawn(bin, args, {
          stdio: ["pipe", "pipe", "pipe"],
          shell: useShell,
        });
        let stdout = "";
        let stderr = "";
        child.stdout?.on("data", (d) => (stdout += String(d)));
        child.stderr?.on("data", (d) => (stderr += String(d)));
        child.on("error", reject);
        child.on("close", (code) => resolve({ stdout, stderr, code: code ?? 0 }));
        if (input) child.stdin?.end(input);
        else child.stdin?.end();
      });
  } catch {
    return null;
  }
}
