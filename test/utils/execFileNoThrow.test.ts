// execFileNoThrow — safe child-process wrapper (no shell, never throws).
// The real spawn impl is injected so the contract is unit-testable without
// touching the host OS.

import { describe, expect, it } from "vitest";
import {
  execFileNoThrow,
  type ExecFileImpl,
} from "../../src/utils/execFileNoThrow";

describe("execFileNoThrow", () => {
  it("resolves a success result (code 0) and passes args through verbatim", async () => {
    let seen: { cmd: string; args: string[] } | null = null;
    const fakeExec: ExecFileImpl = (cmd, args, _opts, cb) => {
      seen = { cmd, args };
      cb(null, "hello\n", "");
    };
    const r = await execFileNoThrow("whisper", ["--model", "tiny"], {
      exec: fakeExec,
    });
    expect(r.code).toBe(0);
    expect(r.stdout).toBe("hello\n");
    expect(seen).toEqual({ cmd: "whisper", args: ["--model", "tiny"] });
  });

  it("maps a process error to a non-zero code + error message (never throws)", async () => {
    const fakeExec: ExecFileImpl = (_cmd, _args, _opts, cb) => {
      const err = Object.assign(new Error("ENOENT"), { code: 127 });
      cb(err, "", "not found");
    };
    const r = await execFileNoThrow("nope", [], { exec: fakeExec });
    expect(r.code).toBe(127);
    expect(r.error).toContain("ENOENT");
    expect(r.stderr).toBe("not found");
  });

  it("returns an 'unavailable' result (never throws) when no exec impl exists", async () => {
    const r = await execFileNoThrow("x", [], { exec: null });
    expect(r.code).toBeNull();
    expect(r.error).toMatch(/unavailable/i);
  });

  it("does not throw when the exec impl itself throws synchronously", async () => {
    const throwingExec: ExecFileImpl = () => {
      throw new Error("spawn boom");
    };
    const r = await execFileNoThrow("x", [], { exec: throwingExec });
    expect(r.code).toBeNull();
    expect(r.error).toContain("spawn boom");
  });
});
