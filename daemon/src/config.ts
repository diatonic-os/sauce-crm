// sauce-crm-daemon · configuration + central-path resolution.
//
// Reuses the plugin's PURE per-user path helpers (src/services/platformPaths)
// so the daemon's data lives in the SAME central location the plugin uses —
// `<app.data.user>/sauce-crm`. The daemon config file lives at
// `<central>/daemon/config.json` (mode 0600); per-vault Lance stores live at
// the SAME `lanceDataDir(env, vaultBasePath)` the plugin resolves, so the
// single-writer rule holds: when the daemon owns a vault's store, the plugin
// sees /health and SKIPS its own initLanceBackend.
//
// Token is minted via the bridge Pairing code (generatePairingToken) on first
// run and written 0600. The daemon and plugin derive the SAME HMAC key from it
// via tokenToKey — identical to the mobile bridge pairing.

import {
  appDataRoot,
  lanceDataDir,
  lanceRuntimeDir,
  firstExistingModuleBase,
  currentPathEnv,
  type PathEnv,
} from "../../src/services/platformPaths";
import { generatePairingToken } from "../../src/bridge/auth";

/** Default loopback bind + port (design constants, overridable via CLI/env). */
export const DEFAULT_PORT = 8788;
export const DEFAULT_BIND_HOST = "127.0.0.1";

/** On-disk daemon config shape. */
export interface DaemonConfig {
  /** Wire-compat version of the config schema. */
  version: 1;
  /** loopback bind host. Constants pin this to 127.0.0.1. */
  bindHost: string;
  /** TCP port. */
  port: number;
  /** Shared pairing token (hex). Same token the plugin enters to pair. */
  pairingToken: string;
  /** Vaults the daemon serves. The DEFAULT vault is served when a request
   *  carries no `x-sauce-vault` header. Additional vaults may be registered by
   *  absolute base path; each maps to its own Lance store via lanceDataDir. */
  defaultVault: string | null;
  /** Extra registered vault base paths (absolute). */
  vaults: string[];
  /** Explicit opt-in to bind a non-loopback interface (0.0.0.0/::). Absent /
   *  false = loopback only (secure default). Surfaced so the exposure is an
   *  auditable config edit, never an accident. */
  allowNonLoopback?: boolean;
  /** Local Whisper transcription served over POST /v1/transcribe. Disabled by
   *  default. `binaryPath` must be an absolute path (validated before spawn);
   *  the daemon's installer (--with-whisper) can provision it. */
  whisper?: WhisperDaemonConfig;
}

/** Daemon-side Whisper config. The daemon MAY auto-install whisper via its
 *  packaging script (our channel); this config points the route at the binary. */
export interface WhisperDaemonConfig {
  /** Route is served only when true. Default false. */
  enabled: boolean;
  /** Absolute path to the whisper CLI. Empty = route returns 503. */
  binaryPath?: string;
  /** Default model id. */
  model?: string;
}

/** Resolved, fully-qualified runtime paths for one daemon process. */
export interface ResolvedPaths {
  env: PathEnv;
  centralRoot: string;
  configPath: string;
  runtimeBase: string | undefined;
}

/** Absolute path to the daemon config file under the central data root. */
export function daemonConfigPath(env: PathEnv): string {
  return `${appDataRoot(env)}/daemon/config.json`;
}

/** Resolve every path the daemon needs from a PathEnv (pure). */
export function resolvePaths(env: PathEnv, configOverride?: string): ResolvedPaths {
  const centralRoot = appDataRoot(env);
  const configPath = configOverride ?? daemonConfigPath(env);
  // Reuse the plugin's native-module discovery: prefer the shared central
  // runtime install; the daemon bundle externalizes @lancedb/lancedb, so it is
  // required from this resolved base at runtime.
  const runtimeBase = firstExistingModuleBase([lanceRuntimeDir(env), undefined]);
  return { env, centralRoot, configPath, runtimeBase };
}

/** Per-vault Lance data dir — the SAME function the plugin uses, so the daemon
 *  and plugin agree byte-for-byte on a vault's store location. */
export function vaultLanceDir(env: PathEnv, vaultBasePath: string): string {
  return lanceDataDir(env, vaultBasePath);
}

/** A freshly minted default config (token generated via the bridge Pairing
 *  code). Pure given an injected token generator (defaults to the real one). */
export function freshConfig(
  overrides?: Partial<DaemonConfig>,
  genToken: () => string = generatePairingToken,
): DaemonConfig {
  return {
    version: 1,
    bindHost: overrides?.bindHost ?? DEFAULT_BIND_HOST,
    port: overrides?.port ?? DEFAULT_PORT,
    pairingToken: overrides?.pairingToken ?? genToken(),
    defaultVault: overrides?.defaultVault ?? null,
    vaults: overrides?.vaults ?? [],
    ...(overrides?.allowNonLoopback !== undefined
      ? { allowNonLoopback: overrides.allowNonLoopback }
      : {}),
    ...(overrides?.whisper !== undefined ? { whisper: overrides.whisper } : {}),
  };
}

/** Narrow an unknown blob into a WhisperDaemonConfig (or undefined). */
function coerceWhisper(raw: unknown): WhisperDaemonConfig | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const r = raw as Record<string, unknown>;
  const enabled = r.enabled === true;
  const cfg: WhisperDaemonConfig = { enabled };
  if (typeof r.binaryPath === "string" && r.binaryPath.length > 0) {
    cfg.binaryPath = r.binaryPath;
  }
  if (typeof r.model === "string" && r.model.length > 0) {
    cfg.model = r.model;
  }
  return cfg;
}

/** Narrow an unknown parsed JSON blob into a DaemonConfig, filling defaults for
 *  missing optional fields. Throws on a structurally invalid config. */
export function coerceConfig(raw: unknown): DaemonConfig {
  if (typeof raw !== "object" || raw === null) {
    throw new Error("daemon config: not an object");
  }
  const r = raw as Record<string, unknown>;
  const token = r.pairingToken;
  if (typeof token !== "string" || token.length === 0) {
    throw new Error("daemon config: missing pairingToken");
  }
  const vaults = Array.isArray(r.vaults)
    ? r.vaults.filter((v): v is string => typeof v === "string")
    : [];
  return {
    version: 1,
    bindHost: typeof r.bindHost === "string" ? r.bindHost : DEFAULT_BIND_HOST,
    port: typeof r.port === "number" ? r.port : DEFAULT_PORT,
    pairingToken: token,
    defaultVault:
      typeof r.defaultVault === "string" ? r.defaultVault : null,
    vaults,
    ...(r.allowNonLoopback === true ? { allowNonLoopback: true } : {}),
    ...(coerceWhisper(r.whisper) !== undefined
      ? { whisper: coerceWhisper(r.whisper)! }
      : {}),
  };
}

// ───────────────────────── filesystem IO (Node) ─────────────────────────

/** Load the config from disk, or create-and-persist a fresh one (0600) on first
 *  run. Returns the config plus whether it was newly created (so the entrypoint
 *  can print the pairing token once). The directory is created 0700; the file
 *  0600 — neither the token nor the dir is group/world readable. */
export async function loadOrCreateConfig(
  configPath: string,
  overrides?: Partial<DaemonConfig>,
): Promise<{ config: DaemonConfig; created: boolean }> {
  const fs = await import("node:fs");
  const path = await import("node:path");
  if (fs.existsSync(configPath)) {
    const raw = await fs.promises.readFile(configPath, "utf8");
    const config = coerceConfig(JSON.parse(raw));
    // Apply non-secret overrides (port/bind/vault) without rotating the token.
    const merged: DaemonConfig = {
      ...config,
      bindHost: overrides?.bindHost ?? config.bindHost,
      port: overrides?.port ?? config.port,
      defaultVault: overrides?.defaultVault ?? config.defaultVault,
    };
    return { config: merged, created: false };
  }
  const config = freshConfig(overrides);
  await fs.promises.mkdir(path.dirname(configPath), {
    recursive: true,
    mode: 0o700,
  });
  await writeConfig(configPath, config);
  return { config, created: true };
}

/** Atomically write the config with 0600 permissions (owner read/write only). */
export async function writeConfig(
  configPath: string,
  config: DaemonConfig,
): Promise<void> {
  const fs = await import("node:fs");
  const tmp = `${configPath}.tmp-${process.pid}`;
  await fs.promises.writeFile(tmp, JSON.stringify(config, null, 2), {
    mode: 0o600,
  });
  // chmod again in case a prior umask widened the temp file before rename.
  await fs.promises.chmod(tmp, 0o600);
  await fs.promises.rename(tmp, configPath);
  await fs.promises.chmod(configPath, 0o600);
}

/** Live process env → PathEnv (delegates to the plugin's resolver). */
export { currentPathEnv };
