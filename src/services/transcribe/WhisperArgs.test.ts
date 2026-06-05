// CON-SAUCEBOT S8 — argv allowlist builder + binary-path validation specs.

import { describe, expect, it } from "vitest";

import {
  buildWhisperArgs,
  WhisperArgError,
  validateBinaryPath,
  isAbsoluteBinaryPath,
  candidateBinaryPaths,
  type PathProbe,
} from "./WhisperArgs";

describe("buildWhisperArgs", () => {
  it("builds the fixed argv order with defaults", () => {
    const args = buildWhisperArgs("/audio/note.m4a", "/tmp/out");
    expect(args).toEqual([
      "/audio/note.m4a",
      "--model",
      "large-v3-turbo",
      "--output_format",
      "txt",
      "--output_dir",
      "/tmp/out",
    ]);
  });

  it("passes the audio path as a SINGLE argv entry even with shell metachars", () => {
    const nasty = "/audio/$(rm -rf ~); drop.m4a";
    const args = buildWhisperArgs(nasty, "/tmp/out");
    // The nasty path is exactly one argv element — never split, never quoted.
    expect(args[0]).toBe(nasty);
    expect(args.filter((a) => a === nasty)).toHaveLength(1);
  });

  it("appends --language only when provided and valid", () => {
    expect(buildWhisperArgs("/a.m4a", "/o", { language: "en" })).toContain(
      "--language",
    );
    expect(buildWhisperArgs("/a.m4a", "/o")).not.toContain("--language");
  });

  it("rejects a model id that could be mistaken for a flag or path", () => {
    expect(() => buildWhisperArgs("/a.m4a", "/o", { model: "--evil" })).toThrow(
      WhisperArgError,
    );
    expect(() =>
      buildWhisperArgs("/a.m4a", "/o", { model: "../../etc/passwd" }),
    ).toThrow(WhisperArgError);
    expect(() => buildWhisperArgs("/a.m4a", "/o", { model: "a b" })).toThrow(
      WhisperArgError,
    );
  });

  it("accepts real whisper model ids", () => {
    for (const m of ["large-v3-turbo", "base.en", "tiny", "medium"]) {
      expect(() =>
        buildWhisperArgs("/a.m4a", "/o", { model: m }),
      ).not.toThrow();
    }
  });

  it("rejects an invalid language hint", () => {
    expect(() =>
      buildWhisperArgs("/a.m4a", "/o", { language: "en; rm -rf" }),
    ).toThrow(WhisperArgError);
  });

  it("rejects an invalid output format", () => {
    expect(() =>
      // @ts-expect-error — exercising the runtime guard
      buildWhisperArgs("/a.m4a", "/o", { outputFormat: "exe" }),
    ).toThrow(WhisperArgError);
  });

  it("rejects empty audio path / output dir", () => {
    expect(() => buildWhisperArgs("", "/o")).toThrow(WhisperArgError);
    expect(() => buildWhisperArgs("/a.m4a", "")).toThrow(WhisperArgError);
  });
});

describe("isAbsoluteBinaryPath", () => {
  it("accepts POSIX, drive, and UNC absolute paths", () => {
    expect(isAbsoluteBinaryPath("/usr/bin/whisper")).toBe(true);
    expect(isAbsoluteBinaryPath("C:\\bin\\whisper.exe")).toBe(true);
    expect(isAbsoluteBinaryPath("C:/bin/whisper.exe")).toBe(true);
    expect(isAbsoluteBinaryPath("\\\\srv\\share\\whisper.exe")).toBe(true);
  });
  it("rejects relative / bare names", () => {
    expect(isAbsoluteBinaryPath("whisper")).toBe(false);
    expect(isAbsoluteBinaryPath("./whisper")).toBe(false);
    expect(isAbsoluteBinaryPath("../whisper")).toBe(false);
    expect(isAbsoluteBinaryPath("")).toBe(false);
  });
});

describe("validateBinaryPath", () => {
  const present: PathProbe = { isFile: () => true, isExecutable: () => true };

  it("rejects a missing config", () => {
    expect(validateBinaryPath(undefined, present).ok).toBe(false);
    expect(validateBinaryPath("", present).ok).toBe(false);
  });

  it("rejects a relative path (no PATH guessing)", () => {
    const r = validateBinaryPath("whisper", present);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/absolute/);
  });

  it("rejects a non-existent file", () => {
    const probe: PathProbe = { isFile: () => false, isExecutable: () => true };
    const r = validateBinaryPath("/usr/bin/whisper", probe);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/not found|not a file/);
  });

  it("rejects a non-executable file", () => {
    const probe: PathProbe = { isFile: () => true, isExecutable: () => false };
    const r = validateBinaryPath("/usr/bin/whisper", probe);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/not executable/);
  });

  it("accepts an absolute, present, executable binary", () => {
    expect(validateBinaryPath("/usr/bin/whisper", present).ok).toBe(true);
  });
});

describe("candidateBinaryPaths", () => {
  it("returns absolute paths for posix", () => {
    const list = candidateBinaryPaths("linux", "/home/me");
    expect(list.every(isAbsoluteBinaryPath)).toBe(true);
    expect(list).toContain("/home/me/.venv/bin/whisper");
  });
  it("returns .exe paths for win32", () => {
    const list = candidateBinaryPaths("win32", "C:\\Users\\me");
    expect(list.every(isAbsoluteBinaryPath)).toBe(true);
    expect(list.some((p) => p.endsWith("whisper.exe"))).toBe(true);
  });
});
