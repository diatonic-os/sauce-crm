import { describe, expect, it } from "vitest";
import {
  parseClaudeResult,
  claudeBinCandidates,
  detectClaudeCode,
} from "../../src/saucebot/ClaudeCodeProvider";

describe("claudeBinCandidates", () => {
  it("offers .cmd/.exe + npm path on Windows", () => {
    const c = claudeBinCandidates("win32", { APPDATA: "C:\\Users\\d\\AppData\\Roaming" }, "C:\\Users\\d");
    expect(c).toContain("claude.cmd");
    expect(c.some((p) => p.endsWith("npm\\claude.cmd"))).toBe(true);
  });
  it("offers PATH + common unix dirs on linux/mac", () => {
    const c = claudeBinCandidates("linux", {}, "/home/d");
    expect(c[0]).toBe("claude");
    expect(c).toContain("/home/d/.local/bin/claude");
  });
});

describe("detectClaudeCode", () => {
  const okVersion = { stdout: "2.1.0 (Claude Code)", stderr: "", code: 0 };
  const okProbe = { stdout: JSON.stringify({ is_error: false, result: "ok", usage: {} }), stderr: "", code: 0 };

  it("finds the first working binary and confirms auth", async () => {
    const runner = (bin: string, args: string[]) =>
      Promise.resolve(args[0] === "--version" ? okVersion : okProbe);
    const r = await detectClaudeCode({ runner, platform: "linux", env: {}, home: "/home/d" });
    expect(r.found).toBe(true);
    expect(r.authed).toBe(true);
    expect(r.binPath).toBe("claude");
    expect(r.models.length).toBeGreaterThan(0);
  });

  it("reports found-but-not-authed when the auth probe fails", async () => {
    const runner = (bin: string, args: string[]) =>
      args[0] === "--version"
        ? Promise.resolve(okVersion)
        : Promise.resolve({ stdout: JSON.stringify({ is_error: true, result: "auth" }), stderr: "", code: 1 });
    const r = await detectClaudeCode({ runner, platform: "linux", env: {}, home: "/h" });
    expect(r.found).toBe(true);
    expect(r.authed).toBe(false);
  });

  it("reports not-found when every candidate errors", async () => {
    const runner = () => Promise.reject(new Error("ENOENT"));
    const r = await detectClaudeCode({ runner, platform: "linux", env: {}, home: "/h" });
    expect(r.found).toBe(false);
    expect(r.error).toBeTruthy();
  });
});

describe("parseClaudeResult", () => {
  it("extracts text + usage + stop reason from a success result", () => {
    const out = JSON.stringify({
      type: "result",
      subtype: "success",
      is_error: false,
      result: "hello world",
      stop_reason: "end_turn",
      usage: { input_tokens: 10, output_tokens: 56 },
    });
    const r = parseClaudeResult(out);
    expect(r.ok).toBe(true);
    expect(r.text).toBe("hello world");
    expect(r.inputTokens).toBe(10);
    expect(r.outputTokens).toBe(56);
    expect(r.stopReason).toBe("end_turn");
  });

  it("reports an API error result", () => {
    const out = JSON.stringify({
      type: "result",
      is_error: true,
      result: "rate limited",
    });
    const r = parseClaudeResult(out);
    expect(r.ok).toBe(false);
    expect(r.error).toContain("rate limited");
  });

  it("handles malformed output without throwing", () => {
    const r = parseClaudeResult("not json <<<");
    expect(r.ok).toBe(false);
    expect(r.error).toBeTruthy();
  });

  it("tolerates leading log lines before the JSON object", () => {
    const out =
      "warning: something\n" +
      JSON.stringify({ is_error: false, result: "ok", usage: {} });
    const r = parseClaudeResult(out);
    expect(r.ok).toBe(true);
    expect(r.text).toBe("ok");
  });
});
