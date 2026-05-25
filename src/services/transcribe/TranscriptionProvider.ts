// CON-SAUCEBOT S8 — transcription provider abstraction.
//
// A `TranscriptionProvider` turns an audio file into text. The default engine
// is local whisper (whisper.cpp `whisper-cli`, or the openai-whisper `whisper`
// CLI on dev hosts) invoked through `execFileNoThrow` (no shell). The
// abstraction lets cloud STT (OpenAI / Deepgram) drop in later exactly like a
// chat provider does.

export interface TranscriptionSegment {
  start: number; // seconds
  end: number; // seconds
  text: string;
}

export interface TranscriptionResult {
  text: string;
  segments?: TranscriptionSegment[];
  /** Detected/!requested language code, when the engine reports it. */
  language?: string;
  durationMs?: number;
}

export interface TranscribeOptions {
  /** ISO language hint (e.g. "en"). Omit for auto-detect. */
  language?: string;
  /** Engine-specific model id (e.g. "large-v3-turbo"). */
  model?: string;
}

export interface TranscriptionProvider {
  /** Stable id (e.g. "whisper-cpp", "openai-whisper", "openai-cloud"). */
  readonly id: string;
  readonly label: string;
  /** Whether this engine can run in the current environment (binary present,
   *  not mobile/sandboxed). Best-effort; never throws. */
  isAvailable(): Promise<boolean>;
  /** Transcribe an audio file at `audioPath`. Throws a descriptive Error on
   *  failure (caller surfaces it — no silent failure). */
  transcribe(
    audioPath: string,
    opts?: TranscribeOptions,
  ): Promise<TranscriptionResult>;
}
