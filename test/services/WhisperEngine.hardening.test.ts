// CON-SAUCEBOT S8 — WhisperEngine hardening specs: path validation, consent
// gate, audit, and child-process registry plumbing.

import { describe, expect, it, vi } from "vitest";
import { WhisperEngine } from "../../src/services/transcribe/WhisperEngine";
import { ChildProcessRegistry } from "../../src/utils/execFileNoThrow";
import type { ExecResult } from "../../src/utils/execFileNoThrow";
import type { PathProbe } from "../../src/services/transcribe/WhisperArgs";

const okRun = async (): Promise<ExecResult> => ({
  code: 0,
  stdout: "",
  stderr: "",
});

const presentProbe: PathProbe = {
  isFile: () => true,
  isExecutable: () => true,
};

describe("WhisperEngine — binary-path validation", () => {
  it("refuses to spawn when the path is relative (no PATH guessing)", async () => {
    const run = vi.fn(okRun);
    const engine = new WhisperEngine({
      run,
      readText: async () => "x",
      binPath: "whisper", // relative — must be rejected
      pathProbe: presentProbe,
      outputDir: "/tmp",
    });
    await expect(engine.transcribe("/a.m4a")).rejects.toThrow(/absolute/);
    expect(run).not.toHaveBeenCalled();
  });

  it("refuses to spawn when the binary does not exist", async () => {
    const run = vi.fn(okRun);
    const missing: PathProbe = {
      isFile: () => false,
      isExecutable: () => true,
    };
    const engine = new WhisperEngine({
      run,
      readText: async () => "x",
      binPath: "/usr/bin/whisper",
      pathProbe: missing,
      outputDir: "/tmp",
    });
    await expect(engine.transcribe("/a.m4a")).rejects.toThrow(/not runnable/);
    expect(run).not.toHaveBeenCalled();
  });

  it("spawns when the binary is absolute + present + executable", async () => {
    const run = vi.fn(okRun);
    const engine = new WhisperEngine({
      run,
      readText: async () => "transcript",
      binPath: "/usr/bin/whisper",
      pathProbe: presentProbe,
      outputDir: "/tmp",
    });
    const r = await engine.transcribe("/a.m4a");
    expect(r.text).toBe("transcript");
    expect(run).toHaveBeenCalledTimes(1);
    expect(run.mock.calls[0]![0]).toBe("/usr/bin/whisper");
  });
});

describe("WhisperEngine — consent gate", () => {
  it("routes the first spawn through the consent gate with the exact argv", async () => {
    const ask = vi.fn(async () => ({ approved: true }));
    const run = vi.fn(okRun);
    const engine = new WhisperEngine({
      run,
      readText: async () => "t",
      binPath: "/usr/bin/whisper",
      pathProbe: presentProbe,
      outputDir: "/tmp",
      consent: { ask },
    });
    await engine.transcribe("/a.m4a", { language: "en" });
    expect(ask).toHaveBeenCalledTimes(1);
    const req = ask.mock.calls[0]![0];
    expect(req.actionClass).toBe("spawn-process");
    expect(req.details).toContain("/usr/bin/whisper");
    expect(req.details).toContain("/a.m4a");
  });

  it("does NOT re-prompt on the second spawn in the same session", async () => {
    const ask = vi.fn(async () => ({ approved: true }));
    const engine = new WhisperEngine({
      run: okRun,
      readText: async () => "t",
      binPath: "/usr/bin/whisper",
      pathProbe: presentProbe,
      outputDir: "/tmp",
      consent: { ask },
    });
    await engine.transcribe("/a.m4a");
    await engine.transcribe("/b.m4a");
    expect(ask).toHaveBeenCalledTimes(1);
  });

  it("aborts the spawn when consent is denied", async () => {
    const ask = vi.fn(async () => ({ approved: false }));
    const run = vi.fn(okRun);
    const engine = new WhisperEngine({
      run,
      readText: async () => "t",
      binPath: "/usr/bin/whisper",
      pathProbe: presentProbe,
      outputDir: "/tmp",
      consent: { ask },
    });
    await expect(engine.transcribe("/a.m4a")).rejects.toThrow(/denied/);
    expect(run).not.toHaveBeenCalled();
  });
});

describe("WhisperEngine — audit + registry", () => {
  it("appends an audit entry per spawn with the argv", async () => {
    const audit = vi.fn(async () => {});
    const engine = new WhisperEngine({
      run: okRun,
      readText: async () => "t",
      binPath: "/usr/bin/whisper",
      pathProbe: presentProbe,
      outputDir: "/tmp",
      audit,
    });
    await engine.transcribe("/a.m4a");
    expect(audit).toHaveBeenCalledTimes(1);
    const [op, , details] = audit.mock.calls[0]!;
    expect(op).toBe("spawn-process");
    expect(details.tool).toBe("whisper");
    expect(Array.isArray(details.args)).toBe(true);
  });

  it("passes the child-process registry into the spawn opts", async () => {
    const registry = new ChildProcessRegistry();
    const run = vi.fn(okRun);
    const engine = new WhisperEngine({
      run,
      readText: async () => "t",
      binPath: "/usr/bin/whisper",
      pathProbe: presentProbe,
      outputDir: "/tmp",
      registry,
    });
    await engine.transcribe("/a.m4a");
    const opts = run.mock.calls[0]![2] as { registry?: unknown };
    expect(opts.registry).toBe(registry);
  });
});
