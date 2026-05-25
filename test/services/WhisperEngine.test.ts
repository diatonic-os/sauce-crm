// WhisperEngine — local-whisper transcription via execFileNoThrow, with the
// spawn + transcript-read seams injected so the contract is testable without
// a real whisper binary.

import { describe, expect, it, vi } from "vitest";
import { WhisperEngine } from "../../src/services/transcribe/WhisperEngine";
import type { ExecResult } from "../../src/utils/execFileNoThrow";

function engineWith(
  run: (cmd: string, args: string[]) => Promise<ExecResult>,
  readText: (path: string) => Promise<string | null>,
) {
  return new WhisperEngine({
    run,
    readText,
    binPath: "whisper",
    outputDir: "/tmp/sb",
    defaultModel: "large-v3-turbo",
  });
}

describe("WhisperEngine", () => {
  it("invokes the whisper binary with the audio path + model and returns the transcript", async () => {
    let seenArgs: string[] = [];
    const run = vi.fn(async (_cmd: string, args: string[]) => {
      seenArgs = args;
      return { code: 0, stdout: "done", stderr: "" } as ExecResult;
    });
    const readText = vi.fn(async () => "the transcript text");
    const engine = engineWith(run, readText);

    const r = await engine.transcribe("/audio/note.m4a", { language: "en" });

    expect(r.text).toBe("the transcript text");
    expect(seenArgs).toContain("/audio/note.m4a");
    expect(seenArgs).toContain("large-v3-turbo");
    expect(seenArgs).toContain("en");
    expect(readText).toHaveBeenCalledWith("/tmp/sb/note.txt");
  });

  it("throws a descriptive error on non-zero exit (no silent failure)", async () => {
    const run = async () =>
      ({ code: 1, stdout: "", stderr: "model not found" }) as ExecResult;
    const engine = engineWith(run, async () => null);
    await expect(engine.transcribe("/a.m4a")).rejects.toThrow(/model not found/);
  });

  it("throws when the binary is unavailable (code null)", async () => {
    const run = async () =>
      ({
        code: null,
        stdout: "",
        stderr: "",
        error: "exec unavailable",
      }) as ExecResult;
    const engine = engineWith(run, async () => null);
    await expect(engine.transcribe("/a.m4a")).rejects.toThrow(/unavailable/);
  });

  it("throws when the transcript file is missing after a successful run", async () => {
    const run = async () => ({ code: 0, stdout: "", stderr: "" }) as ExecResult;
    const engine = engineWith(run, async () => null);
    await expect(engine.transcribe("/a.m4a")).rejects.toThrow(/transcript/i);
  });

  it("reports availability false when the probe command cannot run", async () => {
    const run = async () =>
      ({ code: null, stdout: "", stderr: "", error: "x" }) as ExecResult;
    const engine = engineWith(run, async () => null);
    expect(await engine.isAvailable()).toBe(false);
  });
});
