// CON-SAUCEBOT S8 — local whisper transcription engine.
//
// Drives a local whisper CLI (openai-whisper `whisper`, or whisper.cpp's
// `whisper-cli` with a compatible arg builder) through `execFileNoThrow` — no
// shell, so the audio path and options can never be interpreted as a command.
// The spawn + transcript-read seams are injected so the engine is unit-tested
// without a real binary; production wiring passes execFileNoThrow + a vault
// reader.
//
// Desktop-first: on mobile/sandboxed runtimes the spawn primitive is
// unavailable and `transcribe` throws a clear error (no silent failure) —
// callers fall back to cloud STT or the bridge.

import { execFileNoThrow, type ExecResult } from "../../utils/execFileNoThrow";
import type {
  TranscribeOptions,
  TranscriptionProvider,
  TranscriptionResult,
} from "./TranscriptionProvider";

export interface WhisperEngineDeps {
  /** Spawn seam (default: execFileNoThrow). */
  run?: (
    cmd: string,
    args: string[],
    opts?: { timeoutMs?: number },
  ) => Promise<ExecResult>;
  /** Read the transcript file whisper writes. */
  readText: (path: string) => Promise<string | null>;
  /** whisper binary (PATH name or absolute, e.g. ~/.venv/bin/whisper). */
  binPath?: string;
  /** Directory whisper writes `<name>.txt` into. */
  outputDir: string;
  defaultModel?: string;
  timeoutMs?: number;
}

/** basename without directory or extension: "/a/b/note.m4a" → "note". */
function stem(p: string): string {
  const file = p.slice(p.lastIndexOf("/") + 1);
  const dot = file.lastIndexOf(".");
  return dot > 0 ? file.slice(0, dot) : file;
}

export class WhisperEngine implements TranscriptionProvider {
  readonly id = "whisper-local";
  readonly label = "Whisper (local)";
  private readonly run: NonNullable<WhisperEngineDeps["run"]>;

  constructor(private readonly deps: WhisperEngineDeps) {
    this.run =
      deps.run ?? ((cmd, args, opts) => execFileNoThrow(cmd, args, opts));
  }

  private get bin(): string {
    return this.deps.binPath ?? "whisper";
  }

  async isAvailable(): Promise<boolean> {
    const r = await this.run(this.bin, ["--help"], { timeoutMs: 10_000 });
    return r.code !== null;
  }

  async transcribe(
    audioPath: string,
    opts: TranscribeOptions = {},
  ): Promise<TranscriptionResult> {
    const model = opts.model ?? this.deps.defaultModel ?? "large-v3-turbo";
    const args = [
      audioPath,
      "--model",
      model,
      "--output_format",
      "txt",
      "--output_dir",
      this.deps.outputDir,
    ];
    if (opts.language) args.push("--language", opts.language);

    const started = Date.now();
    const r = await this.run(this.bin, args, {
      timeoutMs: this.deps.timeoutMs ?? 600_000,
    });
    if (r.code === null) {
      throw new Error(
        `whisper unavailable: ${r.error ?? "spawn failed"} (desktop-only; use cloud STT on mobile)`,
      );
    }
    if (r.code !== 0) {
      throw new Error(
        `whisper failed (exit ${r.code}): ${r.stderr || r.error || "unknown error"}`,
      );
    }
    const txtPath = `${this.deps.outputDir}/${stem(audioPath)}.txt`;
    const text = await this.deps.readText(txtPath);
    if (text == null) {
      throw new Error(`whisper produced no transcript at ${txtPath}`);
    }
    return {
      text: text.trim(),
      ...(opts.language !== undefined && { language: opts.language }),
      durationMs: Date.now() - started,
    };
  }
}
