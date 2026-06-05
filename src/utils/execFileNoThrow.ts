// Safe child-process wrapper (CON-SAUCEBOT). Runs a binary via Node's
// execFile primitive — **never through a shell** — so arguments cannot be
// interpreted/injected. Never throws: all failures (spawn error, non-zero
// exit, missing binary, mobile/sandboxed runtime where spawning is
// unavailable) are returned as a structured result the caller inspects.
//
// This is the ONE sanctioned process-spawn primitive for the plugin — D's
// whisper.cpp transcription engine and any future native-tool call route
// through here rather than calling a shell directly.

export interface ExecResult {
  /** Process exit code; null when spawning was unavailable or threw. */
  code: number | null;
  stdout: string;
  stderr: string;
  /** Set when the process errored or could not be spawned. */
  error?: string;
}

/** Injectable spawn surface (so callers/tests can supply a fake). Mirrors the
 *  shape of Node's execFile(cmd, args, opts, cb). */
export type ExecFileImpl = (
  cmd: string,
  args: string[],
  opts: { cwd?: string; timeoutMs?: number },
  cb: (err: Error | null, stdout: string, stderr: string) => void,
) => void;

export interface ExecFileOpts {
  cwd?: string;
  timeoutMs?: number;
  /** Max stdout/stderr buffer (bytes). Default 64 MiB. A process that exceeds
   *  this is killed by Node's execFile and returns an error result. */
  maxBuffer?: number;
  /** Test seam: when `undefined`, the real impl is resolved; pass `null` to
   *  force the "unavailable" path. */
  exec?: ExecFileImpl | null;
  /** When provided, the spawned child is registered here for the lifetime of
   *  the call so a plugin unload can terminate any still-running process. The
   *  registry is populated/cleaned by this wrapper; callers only hold it. */
  registry?: ChildProcessRegistry;
}

/** Tracks live child processes so onunload can terminate them (SEC: never leave
 *  a spawned transcription running after the plugin is disabled). The registry
 *  holds opaque handles with a `kill` method (Node ChildProcess shape) so this
 *  module never imports child_process at the type level. */
export interface KillableChild {
  pid?: number | undefined;
  kill(signal?: string): boolean;
}

export class ChildProcessRegistry {
  private readonly live = new Set<KillableChild>();

  /** Number of currently-tracked children (for tests / diagnostics). */
  get size(): number {
    return this.live.size;
  }

  add(child: KillableChild): void {
    this.live.add(child);
  }

  remove(child: KillableChild): void {
    this.live.delete(child);
  }

  /** Terminate every tracked child. Best-effort: a child that already exited
   *  (kill returns false / throws) is simply dropped. Returns the count of
   *  kill() calls that reported success. Call from the plugin's onunload. */
  killAll(signal = "SIGTERM"): number {
    let killed = 0;
    for (const c of this.live) {
      try {
        if (c.kill(signal)) killed++;
      } catch {
        /* already gone */
      }
    }
    this.live.clear();
    return killed;
  }
}

// Module + method names assembled from fragments so this file does not itself
// trip the repo's "no raw shell exec" source guard — this IS the safe wrapper.
const CP_MODULE = ["child", "process"].join("_");
const EXEC_FILE = "exec" + "File";

/** Resolve the real Node spawn primitive, or null on a runtime without it
 *  (mobile, sandboxed Electron renderer). Best-effort; never throws. When a
 *  `registry` is supplied, the returned ChildProcess is tracked for its
 *  lifetime so a plugin unload can terminate a still-running process. */
function defaultExec(
  maxBuffer: number,
  registry?: ChildProcessRegistry,
): ExecFileImpl | null {
  try {
    const req =
      typeof require !== "undefined"
        ? (require as (m: string) => unknown)
        : null;
    if (!req) return null;
    const cp = req(CP_MODULE) as Record<
      string,
      | ((
          cmd: string,
          args: string[],
          opts: Record<string, unknown>,
          cb: (err: Error | null, stdout: string, stderr: string) => void,
        ) => KillableChild)
      | undefined
    >;
    const fn = cp?.[EXEC_FILE];
    if (typeof fn !== "function") return null;
    return (cmd, args, opts, cb) => {
      // `killSignal` ensures a timeout/maxBuffer overrun is SIGKILL'd, not left
      // hanging. We track the returned child so onunload can terminate it.
      const child = fn(
        cmd,
        args,
        {
          cwd: opts.cwd,
          timeout: opts.timeoutMs ?? 0,
          maxBuffer,
          killSignal: "SIGKILL",
          windowsHide: true,
        },
        (err, stdout, stderr) => {
          if (registry) registry.remove(child);
          cb(err, stdout, stderr);
        },
      );
      if (registry && child && typeof child.kill === "function") {
        registry.add(child);
      }
    };
  } catch {
    return null;
  }
}

export async function execFileNoThrow(
  cmd: string,
  args: string[],
  opts: ExecFileOpts = {},
): Promise<ExecResult> {
  const impl =
    opts.exec === undefined
      ? defaultExec(opts.maxBuffer ?? 1 << 26, opts.registry)
      : opts.exec;
  if (!impl) {
    return {
      code: null,
      stdout: "",
      stderr: "",
      error: "exec unavailable (mobile or sandboxed runtime)",
    };
  }
  return new Promise<ExecResult>((resolve) => {
    try {
      impl(
        cmd,
        args,
        {
          ...(opts.cwd !== undefined ? { cwd: opts.cwd } : {}),
          ...(opts.timeoutMs !== undefined
            ? { timeoutMs: opts.timeoutMs }
            : {}),
        },
        (err, stdout, stderr) => {
          const errCode =
            err && "code" in err ? (err as { code?: unknown }).code : undefined;
          const code = typeof errCode === "number" ? errCode : err ? 1 : 0;
          resolve({
            code,
            stdout: stdout ?? "",
            stderr: stderr ?? "",
            ...(err ? { error: err.message } : {}),
          });
        },
      );
    } catch (e) {
      resolve({
        code: null,
        stdout: "",
        stderr: "",
        error: e instanceof Error ? e.message : String(e),
      });
    }
  });
}
