// CON-SAUCEBOT S8 — whisper argv allowlist builder + binary-path validation.
//
// HARD policy: no user-supplied string is ever interpolated into a shell. The
// engine runs via execFile (argv array), and EVERY argv entry is produced here
// from a closed allowlist of flags. File paths are passed as single argv
// entries (never concatenated, never quoted, never split), so an audio path
// containing spaces / `;` / `$()` is just one inert argument to whisper.
//
// This module is pure (no fs, no spawn) so it unit-tests without a runtime and
// is imported by BOTH the plugin engine and the daemon transcribe handler.

/** Options the caller may influence. Anything not on the allowlist is dropped. */
export interface WhisperArgOptions {
  /** Engine model id (e.g. "large-v3-turbo"). Validated against a charset. */
  model?: string;
  /** ISO language hint (e.g. "en"). Validated against a charset. */
  language?: string;
  /** Output format whisper writes. Only "txt"/"json"/"srt"/"vtt" allowed. */
  outputFormat?: "txt" | "json" | "srt" | "vtt";
}

/** The closed set of output formats we will ask whisper to emit. */
const ALLOWED_OUTPUT_FORMATS = new Set(["txt", "json", "srt", "vtt"]);

/** A model id is a conservative token: letters, digits, dot, dash, underscore.
 *  whisper model names ("large-v3-turbo", "base.en") all fit; nothing that
 *  could be mistaken for a flag (no leading dash) or a path (no slash) passes. */
const MODEL_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

/** A language hint is an ISO-ish token: letters and a single optional dash. */
const LANG_RE = /^[A-Za-z]{2,3}(-[A-Za-z]{2,4})?$/;

export class WhisperArgError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WhisperArgError";
  }
}

/**
 * Build the exact argv array (excluding the binary itself) for a whisper run.
 *
 * Order is fixed and reviewer-auditable:
 *   [ <audioPath>, --model <m>, --output_format <fmt>, --output_dir <dir>,
 *     (--language <lang>)? ]
 *
 * - `audioPath` and `outputDir` are passed verbatim as SINGLE argv entries.
 *   They are NOT validated for shell-safety here because execFile never invokes
 *   a shell — a path is an opaque argument. They ARE checked to be non-empty.
 * - `model` / `language` are validated against a strict charset; an invalid
 *   value throws rather than being silently dropped (fail loud).
 * - No other flags are ever added. There is no passthrough of arbitrary args.
 */
export function buildWhisperArgs(
  audioPath: string,
  outputDir: string,
  opts: WhisperArgOptions = {},
): string[] {
  if (typeof audioPath !== "string" || audioPath.length === 0) {
    throw new WhisperArgError("audioPath must be a non-empty string");
  }
  if (typeof outputDir !== "string" || outputDir.length === 0) {
    throw new WhisperArgError("outputDir must be a non-empty string");
  }

  const model = opts.model ?? "large-v3-turbo";
  if (!MODEL_RE.test(model)) {
    throw new WhisperArgError(`invalid model id: ${JSON.stringify(model)}`);
  }

  const outputFormat = opts.outputFormat ?? "txt";
  if (!ALLOWED_OUTPUT_FORMATS.has(outputFormat)) {
    throw new WhisperArgError(
      `invalid output format: ${JSON.stringify(outputFormat)}`,
    );
  }

  const args: string[] = [
    audioPath,
    "--model",
    model,
    "--output_format",
    outputFormat,
    "--output_dir",
    outputDir,
  ];

  if (opts.language !== undefined) {
    if (!LANG_RE.test(opts.language)) {
      throw new WhisperArgError(
        `invalid language hint: ${JSON.stringify(opts.language)}`,
      );
    }
    args.push("--language", opts.language);
  }

  return args;
}

/** The fixed argv used to probe whether a binary is a working whisper CLI
 *  (exit 0 with no side effects). Kept here so plugin + tests agree. */
export const WHISPER_PROBE_ARGS: readonly string[] = ["--help"];

// ───────────────────────── binary-path validation ─────────────────────────

/** Minimal fs surface the validator needs (injected so it unit-tests without a
 *  real filesystem and stays import-safe on mobile where fs is absent). */
export interface PathProbe {
  /** True iff `path` exists AND is a regular file. */
  isFile(path: string): boolean;
  /** True iff `path` is executable by the current user. On Windows where the
   *  x-bit is meaningless, an implementation may return true for any file. */
  isExecutable(path: string): boolean;
}

export interface ValidatedBinary {
  ok: boolean;
  /** Human-readable reason when `ok` is false. */
  reason?: string;
}

/** Is this an absolute path? Accepts POSIX ("/usr/bin/whisper") and Windows
 *  ("C:\\…", "\\\\server\\share", "C:/…"). No PATH guessing — relative or bare
 *  names are rejected so the binary location is always explicit. */
export function isAbsoluteBinaryPath(p: string): boolean {
  if (typeof p !== "string" || p.length === 0) return false;
  if (p.startsWith("/")) return true; // POSIX absolute
  if (/^[A-Za-z]:[\\/]/.test(p)) return true; // C:\ or C:/
  if (p.startsWith("\\\\")) return true; // UNC
  return false;
}

/**
 * Validate a configured whisper binary path before any spawn:
 *   1. must be an ABSOLUTE path (no PATH guessing, no relative traversal),
 *   2. must exist and be a regular file,
 *   3. must be executable by the current user.
 *
 * Pure given an injected {@link PathProbe}; production wires it to node:fs.
 */
export function validateBinaryPath(
  binPath: string | undefined,
  probe: PathProbe,
): ValidatedBinary {
  if (!binPath || binPath.length === 0) {
    return { ok: false, reason: "no binary path configured" };
  }
  if (!isAbsoluteBinaryPath(binPath)) {
    return {
      ok: false,
      reason:
        "binary path must be absolute (PATH lookup is disabled for safety) — " +
        `got ${JSON.stringify(binPath)}`,
    };
  }
  if (!probe.isFile(binPath)) {
    return { ok: false, reason: `binary not found or not a file: ${binPath}` };
  }
  if (!probe.isExecutable(binPath)) {
    return { ok: false, reason: `binary is not executable: ${binPath}` };
  }
  return { ok: true };
}

/** Common absolute locations a whisper CLI is installed to, for an explicit
 *  opt-in "Detect" action. We never auto-use these — the detect flow surfaces
 *  what it found and asks the operator to confirm one. Ordering is most→least
 *  likely for the host's platform.
 *
 * `home` is the resolved user home (so we avoid `~` expansion at call sites). */
export function candidateBinaryPaths(
  platform: NodeJS.Platform,
  home: string,
): string[] {
  const h = home.replace(/[\\/]+$/, "");
  if (platform === "win32") {
    return [
      `${h}\\.venv\\Scripts\\whisper.exe`,
      `${h}\\AppData\\Local\\Programs\\Python\\Scripts\\whisper.exe`,
      `${h}\\scoop\\shims\\whisper.exe`,
    ];
  }
  // POSIX (linux, darwin, wsl-inner all look the same here).
  const list = [
    `${h}/.venv/bin/whisper`,
    `${h}/.local/bin/whisper`,
    "/usr/local/bin/whisper",
    "/usr/bin/whisper",
    "/opt/homebrew/bin/whisper",
  ];
  if (platform === "darwin") {
    list.push("/opt/homebrew/bin/whisper-cli", "/usr/local/bin/whisper-cli");
  }
  return list;
}
