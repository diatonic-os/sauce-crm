// sauce-crm-daemon · entrypoint.
//
// A headless, localhost-only sidecar that owns a vault's LanceDB store so the
// Obsidian plugin can run lightweight: the plugin probes GET /health first and,
// when the daemon answers, uses the remote backend and SKIPS its own
// initLanceBackend (single-writer rule). Auth reuses the plugin's HMAC pairing.
//
// Run:    node sauce-crm-daemon.cjs [--port N] [--config PATH] [--data-dir DIR]
//                                   [--vault ABS_PATH] [--log-file PATH]
// Config: <central>/daemon/config.json (mode 0600; token minted on first run).

import {
  loadOrCreateConfig,
  resolvePaths,
  currentPathEnv,
  type DaemonConfig,
} from "./config";
import { VaultRegistry } from "./vaults";
import { DaemonServer } from "./server";
import { DAEMON_VERSION } from "./version";
import type { TranscribeFs } from "./transcribe";

interface Argv {
  port?: number;
  config?: string;
  dataDir?: string;
  vault?: string;
  logFile?: string;
}

/** Minimal, dependency-free argv parser for `--flag value` / `--flag=value`. */
export function parseArgv(args: readonly string[]): Argv {
  const out: Argv = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i] ?? "";
    const eq = a.indexOf("=");
    const key = eq >= 0 ? a.slice(0, eq) : a;
    const inlineVal = eq >= 0 ? a.slice(eq + 1) : undefined;
    const next = (): string | undefined =>
      inlineVal !== undefined ? inlineVal : args[++i];
    switch (key) {
      case "--port": {
        const v = next();
        if (v !== undefined) out.port = Number(v);
        break;
      }
      case "--config": {
        const v = next();
        if (v !== undefined) out.config = v;
        break;
      }
      case "--data-dir": {
        const v = next();
        if (v !== undefined) out.dataDir = v;
        break;
      }
      case "--vault": {
        const v = next();
        if (v !== undefined) out.vault = v;
        break;
      }
      case "--log-file": {
        const v = next();
        if (v !== undefined) out.logFile = v;
        break;
      }
      default:
        break;
    }
  }
  return out;
}

/** Env overrides (lower precedence than argv). */
export function envOverrides(
  env: Record<string, string | undefined>,
): Argv {
  const out: Argv = {};
  if (env.SAUCE_DAEMON_PORT) out.port = Number(env.SAUCE_DAEMON_PORT);
  if (env.SAUCE_DAEMON_CONFIG) out.config = env.SAUCE_DAEMON_CONFIG;
  if (env.SAUCE_DAEMON_DATA_DIR) out.dataDir = env.SAUCE_DAEMON_DATA_DIR;
  if (env.SAUCE_DAEMON_VAULT) out.vault = env.SAUCE_DAEMON_VAULT;
  if (env.SAUCE_DAEMON_LOG_FILE) out.logFile = env.SAUCE_DAEMON_LOG_FILE;
  return out;
}

function mergeArgv(envA: Argv, cli: Argv): Argv {
  return { ...envA, ...cli };
}

/** Build a JSONL appender for --log-file, or a no-op when unset. */
async function makeLogger(
  logFile: string | undefined,
): Promise<(e: Record<string, unknown>) => void> {
  if (!logFile) return () => {};
  const fs = await import("node:fs");
  const stream = fs.createWriteStream(logFile, { flags: "a", mode: 0o600 });
  return (e) => stream.write(JSON.stringify(e) + "\n");
}

/** node:fs-backed TranscribeFs for the transcribe route. */
async function makeTranscribeFs(): Promise<TranscribeFs> {
  const fs = await import("node:fs");
  return {
    mkdtemp: (prefix) => fs.promises.mkdtemp(prefix),
    writeFile: (p, data) => fs.promises.writeFile(p, data, { mode: 0o600 }),
    readFile: (p, enc) => fs.promises.readFile(p, enc),
    rm: (p, opts) => fs.promises.rm(p, opts),
    statIsFile: (p) => {
      try {
        return fs.statSync(p).isFile();
      } catch {
        return false;
      }
    },
    accessExecutable: (p) => {
      try {
        fs.accessSync(p, fs.constants.X_OK);
        return true;
      } catch {
        if (process.platform === "win32") {
          try {
            return fs.statSync(p).isFile();
          } catch {
            return false;
          }
        }
        return false;
      }
    },
  };
}

export interface BootedDaemon {
  server: DaemonServer;
  registry: VaultRegistry;
  config: DaemonConfig;
  address: { host: string; port: number };
  shutdown: () => Promise<void>;
}

/** Boot the daemon (no process-level signal wiring — that lives in main()).
 *  Returned so tests can drive it without spawning a process. */
export async function boot(argv: Argv): Promise<BootedDaemon> {
  const env = currentPathEnv();
  const paths = resolvePaths(env, argv.config);
  const { config, created } = await loadOrCreateConfig(paths.configPath, {
    ...(argv.port !== undefined ? { port: argv.port } : {}),
    ...(argv.vault !== undefined ? { defaultVault: argv.vault } : {}),
  });

  const log = await makeLogger(argv.logFile);
  const registry = new VaultRegistry({
    env,
    requireBase: paths.runtimeBase,
  });

  // --data-dir, when supplied, registers a default vault keyed by that path so
  // a caller can point the daemon at a specific store without a config edit.
  const defaultVault = argv.vault ?? config.defaultVault ?? argv.dataDir ?? null;

  // Build a node:fs-backed seam for the transcribe route (POST /v1/transcribe).
  const transcribeFs = await makeTranscribeFs();
  const os = await import("node:os");

  const server = new DaemonServer({
    registry,
    pairingToken: config.pairingToken,
    bindHost: config.bindHost,
    port: config.port,
    version: DAEMON_VERSION,
    defaultVault: () => defaultVault,
    log,
    ...(config.allowNonLoopback !== undefined
      ? { allowNonLoopback: config.allowNonLoopback }
      : {}),
    whisper: () => config.whisper,
    transcribeFs,
    tmpBase: os.tmpdir(),
  });

  const address = await server.start();

  if (created) {
    // First run: surface the pairing token ONCE so the operator can pair the
    // plugin. Written 0600 to config; printed to stdout for convenience.
    log({ ev: "pairing-token", token: config.pairingToken });
    process.stdout.write(
      `sauce-crm-daemon: new pairing token (also in ${paths.configPath}):\n` +
        `${config.pairingToken}\n`,
    );
  }
  process.stdout.write(
    `sauce-crm-daemon v${DAEMON_VERSION} listening on ` +
      `http://${address.host}:${address.port} (pid ${process.pid})\n`,
  );

  const shutdown = async (): Promise<void> => {
    await server.stop(); // stop accepting; in-flight requests already drained
    await registry.closeAll(); // release native Lance handles
  };

  return { server, registry, config, address, shutdown };
}

/** Process entrypoint: boot + wire SIGTERM/SIGINT graceful shutdown. */
export async function main(): Promise<void> {
  const cli = parseArgv(process.argv.slice(2));
  const envA = envOverrides(process.env);
  const argv = mergeArgv(envA, cli);
  const daemon = await boot(argv);

  let shuttingDown = false;
  const onSignal = (sig: string): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    process.stdout.write(`sauce-crm-daemon: ${sig} → graceful shutdown\n`);
    daemon
      .shutdown()
      .then(() => process.exit(0))
      .catch(() => process.exit(1));
  };
  process.on("SIGTERM", () => onSignal("SIGTERM"));
  process.on("SIGINT", () => onSignal("SIGINT"));
}

// Only auto-run when executed directly (not when imported by tests).
const isMain =
  typeof require !== "undefined" &&
  typeof module !== "undefined" &&
  require.main === module;
if (isMain) {
  void main().catch((e) => {
    process.stderr.write(`sauce-crm-daemon: fatal: ${String(e)}\n`);
    process.exit(1);
  });
}
