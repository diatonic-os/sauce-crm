// ─────────────────────────────────────────────────────────────────────────────
//  SUBSHELL TESTS — per SAUCEOM_HARNESS_DIRECTIVE @L3_execution
// ─────────────────────────────────────────────────────────────────────────────

import { describe, expect, it } from "vitest";
import {
  SubshellManager,
  toToolResultPayload,
} from "../../src/saucebot/harness/Subshell";
import type { SpawnSpec, Harvest, ShellExecutor } from "../../src/saucebot/harness/Subshell";

// ─── fakes ──────────────────────────────────────────────────────────────────

const makeExec = (h: Harvest): ShellExecutor => async (_spec) => h;

const throwingExec: ShellExecutor = async (_spec) => {
  throw new Error("child process failed");
};

const okHarvest: Harvest = { stdout: "hello world", stderr: "", exitCode: 0 };
const failHarvest: Harvest = { stdout: "", stderr: "boom", exitCode: 1 };

const baseSpec: SpawnSpec = { cmd: "echo", args: ["hello"], cwd: "/tmp" };

// ─── tests ──────────────────────────────────────────────────────────────────

describe("SubshellManager", () => {
  describe("approved run", () => {
    it("returns ok:true with harvest on exit code 0", async () => {
      const mgr = new SubshellManager(makeExec(okHarvest));
      const result = await mgr.run(baseSpec);

      expect(result.ok).toBe(true);
      expect(result.harvest).toEqual(okHarvest);
      expect(result.blocked).toBeUndefined();
      expect(result.error).toBeUndefined();
    });

    it("returns ok:false with harvest on nonzero exit code", async () => {
      const mgr = new SubshellManager(makeExec(failHarvest));
      const result = await mgr.run(baseSpec);

      expect(result.ok).toBe(false);
      expect(result.harvest).toEqual(failHarvest);
      expect(result.blocked).toBeUndefined();
      expect(result.error).toBeUndefined();
    });
  });

  describe("approvalRequired blocking", () => {
    const approvalSpec: SpawnSpec = {
      ...baseSpec,
      approvalRequired: true,
    };

    it("blocks when approvalRequired and approve returns false", async () => {
      const mgr = new SubshellManager(makeExec(okHarvest), () => false);
      const result = await mgr.run(approvalSpec);

      expect(result.ok).toBe(false);
      expect(result.blocked).toBe(true);
      expect(result.harvest).toBeUndefined();
      expect(result.error).toBeUndefined();
    });

    it("blocks when approvalRequired and no approve fn provided", async () => {
      const mgr = new SubshellManager(makeExec(okHarvest));
      const result = await mgr.run(approvalSpec);

      expect(result.ok).toBe(false);
      expect(result.blocked).toBe(true);
      expect(result.harvest).toBeUndefined();
    });

    it("runs when approvalRequired and approve returns true", async () => {
      const mgr = new SubshellManager(makeExec(okHarvest), () => true);
      const result = await mgr.run(approvalSpec);

      expect(result.ok).toBe(true);
      expect(result.harvest).toEqual(okHarvest);
      expect(result.blocked).toBeUndefined();
    });

    it("does NOT block when approvalRequired is absent (no approve fn)", async () => {
      const mgr = new SubshellManager(makeExec(okHarvest));
      const result = await mgr.run(baseSpec); // no approvalRequired

      expect(result.ok).toBe(true);
    });
  });

  describe("executor throw", () => {
    it("returns ok:false with error string on exec throw", async () => {
      const mgr = new SubshellManager(throwingExec);
      const result = await mgr.run(baseSpec);

      expect(result.ok).toBe(false);
      expect(result.error).toBe("child process failed");
      expect(result.harvest).toBeUndefined();
      expect(result.blocked).toBeUndefined();
    });

    it("converts non-Error throws to string", async () => {
      const weirdExec: ShellExecutor = async () => {
        // eslint-disable-next-line @typescript-eslint/only-throw-error
        throw "string error";
      };
      const mgr = new SubshellManager(weirdExec);
      const result = await mgr.run(baseSpec);

      expect(result.ok).toBe(false);
      expect(typeof result.error).toBe("string");
    });
  });
});

describe("toToolResultPayload", () => {
  it("shapes a successful result into the expected payload", () => {
    const r = { ok: true, harvest: okHarvest };
    const payload = toToolResultPayload(baseSpec, r);

    expect(payload["type"]).toBe("tool_result");
    expect(payload["ok"]).toBe(true);
    expect(payload["stdout"]).toBe("hello world");
    expect(payload["stderr"]).toBe("");
    expect(payload["exitCode"]).toBe(0);
    expect(payload["cmd"]).toBe("echo");
    expect(payload["cwd"]).toBe("/tmp");
  });

  it("shapes a blocked result", () => {
    const r = { ok: false, blocked: true };
    const payload = toToolResultPayload({ ...baseSpec, approvalRequired: true }, r);

    expect(payload["type"]).toBe("tool_result");
    expect(payload["ok"]).toBe(false);
    expect(payload["blocked"]).toBe(true);
    expect(payload["stdout"]).toBeUndefined();
  });

  it("shapes an error result", () => {
    const r = { ok: false, error: "child process failed" };
    const payload = toToolResultPayload(baseSpec, r);

    expect(payload["type"]).toBe("tool_result");
    expect(payload["ok"]).toBe(false);
    expect(payload["error"]).toBe("child process failed");
    expect(payload["stdout"]).toBeUndefined();
  });

  it("includes args in payload when present", () => {
    const r = { ok: true, harvest: okHarvest };
    const payload = toToolResultPayload(baseSpec, r);

    expect(payload["args"]).toEqual(["hello"]);
  });
});
