// CON-SAUCEBOT S8 — ChildProcessRegistry: kill-on-unload tracking + the
// default-exec timeout/kill plumbing.

import { describe, expect, it, vi } from "vitest";
import {
  ChildProcessRegistry,
  execFileNoThrow,
  type ExecFileImpl,
} from "./execFileNoThrow";

describe("ChildProcessRegistry", () => {
  it("kills every tracked child and clears the set", () => {
    const reg = new ChildProcessRegistry();
    const a = { pid: 1, kill: vi.fn(() => true) };
    const b = { pid: 2, kill: vi.fn(() => true) };
    reg.add(a);
    reg.add(b);
    expect(reg.size).toBe(2);
    const killed = reg.killAll();
    expect(killed).toBe(2);
    expect(a.kill).toHaveBeenCalledWith("SIGTERM");
    expect(b.kill).toHaveBeenCalledWith("SIGTERM");
    expect(reg.size).toBe(0);
  });

  it("tolerates a child whose kill throws (already exited)", () => {
    const reg = new ChildProcessRegistry();
    const dead = {
      kill: () => {
        throw new Error("ESRCH");
      },
    };
    reg.add(dead);
    expect(() => reg.killAll()).not.toThrow();
    expect(reg.size).toBe(0);
  });

  it("remove() untracks a child so killAll skips it", () => {
    const reg = new ChildProcessRegistry();
    const c = { kill: vi.fn(() => true) };
    reg.add(c);
    reg.remove(c);
    reg.killAll();
    expect(c.kill).not.toHaveBeenCalled();
  });
});

describe("execFileNoThrow — timeout/kill surfacing", () => {
  it("maps a timeout-killed process to a structured error result (no throw)", async () => {
    // Simulate Node's execFile timeout: the callback fires with an error whose
    // `killed` is true and `signal` is SIGKILL; no exit code.
    const timedOut: ExecFileImpl = (_cmd, _args, _opts, cb) => {
      const err = Object.assign(new Error("timed out"), {
        killed: true,
        signal: "SIGKILL",
      });
      cb(err, "", "");
    };
    const r = await execFileNoThrow("/bin/whisper", ["--help"], {
      exec: timedOut,
      timeoutMs: 5,
    });
    expect(r.error).toMatch(/timed out/);
    // code is non-null (1) because the impl reported an error, not "unavailable".
    expect(r.code).toBe(1);
  });

  it("returns the unavailable result when no impl can be resolved", async () => {
    const r = await execFileNoThrow("/bin/whisper", ["--help"], { exec: null });
    expect(r.code).toBeNull();
    expect(r.error).toMatch(/unavailable/);
  });
});
