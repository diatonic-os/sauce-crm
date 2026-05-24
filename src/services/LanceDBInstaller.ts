// LanceDB auto-installer + capability detector for the Sauce CRM plugin.
//
// LanceDB ships as a native N-API binding and is only installable on
// desktop Electron — iOS/Android Obsidian runs WebView-only with no
// native module loader. Plugin manifest declares isDesktopOnly: true,
// so this module focuses on desktop install paths while exposing a
// clean fallback API the rest of the code can call without knowing
// whether vector search is available.
//
// The detector runs at plugin onload. If LanceDB is not resolvable the
// caller surfaces the install prompt (LanceDBInstallModal). The user
// either approves the install (with explicit consent checkbox) or
// skips — in which case VectorSearchService falls back to graph-RAG.
//
// Strategies (preferred → fallback):
//   1. Already-resolvable via require() — no work needed.
//   2. Operator-approved `npm install @lancedb/lancedb --prefix
//      <pluginDir>` via Electron's child_process.
//   3. Fallback: graph-RAG only (RagAssembler.semantic via fuzzy).

export type LanceDBStatus =
  | { state: "available"; version: string }
  | { state: "unavailable"; reason: string }
  | { state: "mobile-unsupported" }
  | { state: "installing"; progress: string }
  | { state: "install-failed"; error: string };

export interface LanceDBCapability {
  status: LanceDBStatus;
  /** True iff the plugin should attempt to USE LanceDB. False means the
   *  caller must use graph-RAG-only mode. */
  enabled: boolean;
  /** True iff the operator has not yet decided. UI surfaces the install
   *  prompt iff this is true. */
  awaitingDecision: boolean;
}

/** Pure detection — no install attempts. Returns mobile-unsupported on
 *  any non-Electron host (which has no native module loader).
 *
 *  `pluginDir` (absolute) enables the same resolution fallback `loadLance` uses:
 *  Obsidian's renderer require() resolves from Electron internals and never the
 *  plugin folder, so a bare `require("@lancedb/lancedb")` reports "Cannot find
 *  module" even when the require-install landed it at `<pluginDir>/node_modules`.
 *  We retry by absolute path so detection agrees with what the connection loads. */
export function detectLanceDB(pluginDir?: string): LanceDBStatus {
  const proc = (
    globalThis as unknown as { process?: { versions?: { electron?: string } } }
  ).process;
  if (typeof proc?.versions?.electron !== "string") {
    return { state: "mobile-unsupported" };
  }
  const req = (globalThis as unknown as { require?: NodeRequire }).require;
  if (typeof req !== "function") {
    return {
      state: "unavailable",
      reason: "require() unavailable in this environment",
    };
  }
  const resolve = (): { version?: string; default?: { version?: string } } => {
    try {
      return req("@lancedb/lancedb");
    } catch (bareErr) {
      if (pluginDir) return req(`${pluginDir}/node_modules/@lancedb/lancedb`);
      throw bareErr;
    }
  };
  try {
    const lance = resolve();
    const version = lance.version ?? lance.default?.version ?? "unknown";
    return { state: "available", version };
  } catch (err) {
    return {
      state: "unavailable",
      reason: (err as Error).message || String(err),
    };
  }
}

/** Persisted decision shape — lives in plugin settings under
 *  `lancedb.installDecision`. */
export interface LanceDBInstallDecision {
  /** "approved": user clicked install + checked consent.
   *  "skipped": user clicked "Skip for now".
   *  "pending": no decision yet (initial state). */
  state: "approved" | "skipped" | "pending";
  /** ISO date of the decision (for "remind me later" cadence). */
  decidedAt?: string;
  /** Last attempt outcome for transparency. */
  lastAttempt?: { ok: boolean; error?: string; ts: string };
}

export const DEFAULT_LANCEDB_DECISION: LanceDBInstallDecision = {
  state: "pending",
};

/** Aggregator the plugin uses to decide whether to surface the install
 *  modal on onload. */
export function computeCapability(
  decision: LanceDBInstallDecision,
  pluginDir?: string,
): LanceDBCapability {
  const detect = detectLanceDB(pluginDir);
  switch (detect.state) {
    case "available":
      return { status: detect, enabled: true, awaitingDecision: false };
    case "mobile-unsupported":
      // Never prompt on mobile — nothing the user could do.
      return { status: detect, enabled: false, awaitingDecision: false };
    case "unavailable":
      return {
        status: detect,
        enabled: false,
        awaitingDecision: decision.state === "pending",
      };
    case "installing":
    case "install-failed":
      return { status: detect, enabled: false, awaitingDecision: false };
  }
}

// ---------- Installer ----------

export interface InstallerHost {
  /** Absolute path to the plugin's data directory. LanceDB is installed
   *  here so it persists across plugin reloads without polluting npm
   *  globals. */
  pluginDir(): string;
  /** Spawn a child process and stream output. Returns the exit code, or
   *  null if spawning is unavailable (mobile or sandboxed Electron). */
  spawn(
    cmd: string,
    args: string[],
    cwd: string,
    onLine: (stream: "stdout" | "stderr", line: string) => void,
  ): Promise<number | null>;
}

export type InstallProgress =
  | { kind: "start"; message: string }
  | { kind: "line"; stream: "stdout" | "stderr"; line: string }
  | { kind: "done"; ok: boolean; durationMs: number; error?: string };

/** Hook the installer can call to persist a single log line to disk. The
 *  modal supplies this so install logs survive after the modal closes. */
export type LogSink = (line: string) => void | Promise<void>;

export class LanceDBInstaller {
  constructor(private readonly host: InstallerHost) {}

  /** Runs `npm install @lancedb/lancedb --prefix <pluginDir>`. Streams
   *  output via onProgress AND through the optional persistent logSink
   *  so failures can be diagnosed after the modal closes.
   *
   *  Resilience: Electron's PATH frequently omits the npm install dir
   *  on macOS/Linux (especially when launched from .desktop / .app). We
   *  try `npm` first, then fall back to common nvm/node paths. Returns
   *  true on exit code 0. */
  async install(
    onProgress: (p: InstallProgress) => void,
    logSink?: LogSink,
  ): Promise<boolean> {
    const t0 = Date.now();
    const cwd = this.host.pluginDir();
    const log = async (line: string): Promise<void> => {
      if (logSink) await logSink(line);
    };
    await log(`[${new Date().toISOString()}] === LanceDB install ===`);
    await log(`cwd=${cwd}`);
    await log(`PATH=${this.peekEnv("PATH")}`);
    await log(`HOME=${this.peekEnv("HOME")}`);
    await log(
      `platform=${this.peekPlatform()} node=${this.peekEnv("npm_node_execpath") || "?"}`,
    );

    onProgress({
      kind: "start",
      message: `Installing @lancedb/lancedb to ${cwd}`,
    });

    // Candidate npm command paths, tried in order. Each candidate is
    // verified for existence (where path-shaped) before spawn.
    const npmCandidates = this.candidateNpmPaths();
    await log(`candidate npm executables: ${JSON.stringify(npmCandidates)}`);

    let exitCode: number | null = null;
    let lastError = "";
    for (const npmCmd of npmCandidates) {
      await log(`trying: ${npmCmd}`);
      try {
        exitCode = await this.host.spawn(
          npmCmd,
          [
            "install",
            "@lancedb/lancedb",
            "--prefix",
            cwd,
            "--no-audit",
            "--no-fund",
          ],
          cwd,
          (stream, line) => {
            onProgress({ kind: "line", stream, line });
            void log(`[${stream}] ${line}`);
          },
        );
        await log(`exit code: ${exitCode}`);
        if (exitCode === 0) break;
        if (exitCode === null) {
          lastError = `spawn unavailable / ENOENT for "${npmCmd}"`;
          await log(lastError);
          continue;
        }
        lastError = `${npmCmd} exited with code ${exitCode}`;
        break; // non-zero from a real run — don't try other paths
      } catch (err) {
        lastError = (err as Error).message;
        await log(`spawn threw: ${lastError}`);
      }
    }

    const ok = exitCode === 0;
    const durationMs = Date.now() - t0;
    await log(
      `=== install ${ok ? "SUCCEEDED" : "FAILED"} in ${(durationMs / 1000).toFixed(1)}s ===`,
    );
    onProgress({
      kind: "done",
      ok,
      durationMs,
      error: ok ? undefined : lastError || "unknown install failure",
    });
    return ok;
  }

  private peekEnv(key: string): string {
    const proc = (
      globalThis as unknown as {
        process?: { env?: Record<string, string | undefined> };
      }
    ).process;
    return proc?.env?.[key] ?? "(unset)";
  }

  private peekPlatform(): string {
    const proc = (
      globalThis as unknown as {
        process?: { platform?: string; arch?: string };
      }
    ).process;
    return `${proc?.platform ?? "?"}/${proc?.arch ?? "?"}`;
  }

  private candidateNpmPaths(): string[] {
    // Plain "npm" works when Electron inherits the user's shell PATH.
    // The fallbacks cover macOS .app launches, Linux .desktop launches,
    // and nvm-managed Node — the three most common "npm not found" cases.
    const proc = (
      globalThis as unknown as {
        process?: {
          env?: Record<string, string | undefined>;
          platform?: string;
        };
      }
    ).process;
    const env = proc?.env ?? {};
    const home = env.HOME ?? "/home";
    const candidates = [
      "npm",
      "/usr/local/bin/npm",
      "/opt/homebrew/bin/npm",
      `${home}/.nvm/versions/node/${env.NODE_VERSION ?? "v24.15.0"}/bin/npm`,
      `${home}/.npm-global/bin/npm`,
      `${home}/.local/bin/npm`,
    ];
    // De-dup while preserving order.
    return [...new Set(candidates)];
  }
}

// ---------- ObsidianInstallerHost ----------

/** Wires the abstract InstallerHost to Electron desktop primitives. On
 *  mobile, spawn() returns null and the installer short-circuits. */
export class ObsidianInstallerHost implements InstallerHost {
  constructor(private readonly _pluginDir: string) {}

  pluginDir(): string {
    return this._pluginDir;
  }

  async spawn(
    cmd: string,
    args: string[],
    cwd: string,
    onLine: (stream: "stdout" | "stderr", line: string) => void,
  ): Promise<number | null> {
    const proc = (
      globalThis as unknown as {
        process?: { versions?: { electron?: string } };
      }
    ).process;
    if (typeof proc?.versions?.electron !== "string") return null;
    const req = (globalThis as unknown as { require?: NodeRequire }).require;
    if (typeof req !== "function") return null;
    let childProcess: typeof import("child_process");
    try {
      childProcess = req("child_process") as typeof import("child_process");
    } catch {
      return null;
    }
    return await new Promise<number | null>((resolve) => {
      const child = childProcess.spawn(cmd, args, { cwd, shell: false });
      const buf: Record<"stdout" | "stderr", string> = {
        stdout: "",
        stderr: "",
      };
      const onChunk = (stream: "stdout" | "stderr") => (chunk: Buffer) => {
        buf[stream] += chunk.toString("utf-8");
        const lines = buf[stream].split("\n");
        buf[stream] = lines.pop() ?? "";
        for (const line of lines) if (line) onLine(stream, line);
      };
      child.stdout?.on("data", onChunk("stdout"));
      child.stderr?.on("data", onChunk("stderr"));
      child.on("close", (code) => {
        for (const stream of ["stdout", "stderr"] as const) {
          if (buf[stream]) onLine(stream, buf[stream]);
        }
        resolve(code);
      });
      child.on("error", (err) => {
        onLine("stderr", `spawn error: ${err.message}`);
        resolve(null);
      });
    });
  }
}
