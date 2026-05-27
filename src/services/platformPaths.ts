// Cross-platform resolution of the CENTRALIZED, out-of-vault home for the
// LanceDB store and its native module. Implements the sauce-paths-lib
// `app.data.user` path-key intent (per-user persistent data — DBs) for
// Linux / macOS / Windows, WITHOUT hardcoding OS paths at call sites.
//
// Why out of the vault: LanceDB writes thousands of fragment/version files and
// loads tables into memory; keeping that inside the Obsidian vault pollutes the
// file watcher (the "watcher" error) and bloats sync. The vault holds the
// source-of-truth `.md` notes; LanceDB is the DERIVED index and belongs in the
// OS per-user data dir.
//
// Layout under the central root (`<app.data.user>/sauce-crm`):
//   runtime/node_modules/@lancedb/lancedb   ← native module (installed ONCE, shared)
//   vaults/<vaultId>/lancedb                ← per-vault derived store
//
// All resolvers are PURE — they take {platform, env, home} so they unit-test
// across every OS without the host. `currentPathEnv()` reads the live process.

export type Platform = "win32" | "darwin" | "linux" | (string & {});

export interface PathEnv {
  platform: Platform;
  env: Record<string, string | undefined>;
  home: string;
}

/** Vendor/app folder name under the OS data root. Single flat segment. */
const APP_DIR = "sauce-crm";

/** Join POSIX-style, collapsing duplicate slashes. We keep forward slashes
 *  internally on every platform — Node's fs and LanceDB's native connect()
 *  accept them on Windows too — and only the env-provided base may carry
 *  backslashes, which we normalize. */
function joinPosix(...parts: string[]): string {
  return parts
    .filter((p) => p && p.length > 0)
    .join("/")
    .replace(/\\/g, "/")
    .replace(/\/{2,}/g, "/");
}

/** OS per-user DATA root for this app (`app.data.user`). Never the vault;
 *  never the roaming profile on Windows (a local DB must not roam). */
export function appDataRoot(p: PathEnv): string {
  if (p.platform === "win32") {
    const base =
      nonEmpty(p.env.LOCALAPPDATA) ??
      (nonEmpty(p.env.USERPROFILE)
        ? joinPosix(p.env.USERPROFILE as string, "AppData/Local")
        : undefined) ??
      nonEmpty(p.env.APPDATA) ??
      joinPosix(p.home, "AppData/Local");
    return joinPosix(base, APP_DIR);
  }
  if (p.platform === "darwin") {
    return joinPosix(p.home, "Library/Application Support", APP_DIR);
  }
  // Linux and other POSIX: respect XDG_DATA_HOME, else ~/.local/share.
  const xdg = nonEmpty(p.env.XDG_DATA_HOME) ?? joinPosix(p.home, ".local/share");
  return joinPosix(xdg, APP_DIR);
}

function nonEmpty(s: string | undefined): string | undefined {
  return s && s.trim().length > 0 ? s.trim() : undefined;
}

/** Shared native-module install prefix: `npm install --prefix <here>` lands the
 *  module at `<here>/node_modules/@lancedb/lancedb`. Shared across all vaults. */
export function lanceRuntimeDir(p: PathEnv): string {
  return joinPosix(appDataRoot(p), "runtime");
}

/** A stable, filesystem-safe id for a vault, derived from its ABSOLUTE base
 *  path so the same vault always maps to the same store regardless of its name.
 *  Form: `<sanitized-basename>-<hash8>` — readable + collision-resistant. */
export function vaultId(vaultBasePath: string): string {
  const norm = vaultBasePath.replace(/\\/g, "/").replace(/\/+$/, "");
  const base =
    norm.split("/").filter(Boolean).pop() ?? "vault";
  const safe = base.replace(/[^A-Za-z0-9._-]/g, "-").slice(0, 40) || "vault";
  return `${safe}-${hash8(norm)}`;
}

/** Per-vault derived LanceDB store under the central root. */
export function lanceDataDir(p: PathEnv, vaultBasePath: string): string {
  return joinPosix(appDataRoot(p), "vaults", vaultId(vaultBasePath), "lancedb");
}

/** Legacy (v1) in-vault store location, to migrate FROM. */
export function legacyLanceDir(absPluginDir: string): string {
  return joinPosix(absPluginDir, "data/lancedb");
}

/** Central, out-of-vault file holding safeStorage-encrypted secret blobs. The
 *  decryption key lives in the OS keychain (safeStorage), so this file is
 *  OS-bound ciphertext — safe outside the vault and never synced. */
export function secretsFile(p: PathEnv): string {
  return joinPosix(appDataRoot(p), "secrets.json");
}

/** Small, dependency-free 32-bit hash (cyrb53-lite) rendered as 8 hex chars.
 *  Not cryptographic — only needs to be stable + well-distributed for ids. */
function hash8(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

export interface MigrationResult {
  migrated: boolean;
  reason:
    | "moved"
    | "copied"
    | "no-legacy"
    | "target-exists"
    | "failed"
    | "unavailable";
  error?: string;
}

/** Migrate a legacy v1 in-vault LanceDB store to the central out-of-vault
 *  location. Safe + idempotent:
 *   - no-op when no legacy store exists ("no-legacy")
 *   - NEVER clobbers a populated target ("target-exists")
 *   - tries `rename` (instant, even for a 58k-file bloated dir, when same FS);
 *     falls back to recursive copy + remove on EXDEV (cross-filesystem)
 *  Renderer-safe (lazy `fs`/`path` require). */
export async function migrateLegacyStore(
  legacyDir: string,
  targetDir: string,
): Promise<MigrationResult> {
  const req =
    (globalThis as unknown as { require?: NodeRequire }).require ??
    (typeof require !== "undefined" ? require : undefined);
  if (typeof req !== "function") return { migrated: false, reason: "unavailable" };
  let fs: typeof import("fs");
  let path: typeof import("path");
  try {
    fs = req("fs") as typeof import("fs");
    path = req("path") as typeof import("path");
  } catch {
    return { migrated: false, reason: "unavailable" };
  }
  if (!fs.existsSync(legacyDir)) return { migrated: false, reason: "no-legacy" };
  if (fs.existsSync(targetDir)) {
    try {
      if (fs.readdirSync(targetDir).length > 0) {
        return { migrated: false, reason: "target-exists" };
      }
    } catch {
      /* unreadable target → treat as empty and proceed */
    }
  }
  try {
    fs.mkdirSync(path.dirname(targetDir), { recursive: true });
  } catch {
    /* parent may already exist */
  }
  try {
    await fs.promises.rename(legacyDir, targetDir);
    return { migrated: true, reason: "moved" };
  } catch {
    // EXDEV (vault on a different filesystem than the data dir) → copy + remove.
    try {
      await fs.promises.cp(legacyDir, targetDir, { recursive: true });
      await fs.promises.rm(legacyDir, { recursive: true, force: true });
      return { migrated: true, reason: "copied" };
    } catch (e2) {
      return { migrated: false, reason: "failed", error: String(e2) };
    }
  }
}

/** Given candidate install prefixes (central runtime first, legacy plugin dir
 *  second), return the first whose `node_modules/@lancedb/lancedb` exists on
 *  disk. Lets existing in-plugin installs keep working while new installs land
 *  centrally. Returns the first candidate (install target) when none exist yet.
 *  Renderer-safe (lazy fs). */
export function firstExistingModuleBase(
  candidates: ReadonlyArray<string | undefined>,
): string | undefined {
  const present = candidates.filter((c): c is string => !!c);
  if (present.length === 0) return undefined;
  const req =
    (globalThis as unknown as { require?: NodeRequire }).require ??
    (typeof require !== "undefined" ? require : undefined);
  if (typeof req !== "function") return present[0];
  let fs: typeof import("fs");
  try {
    fs = req("fs") as typeof import("fs");
  } catch {
    return present[0];
  }
  for (const base of present) {
    try {
      if (fs.existsSync(joinPosix(base, "node_modules/@lancedb/lancedb"))) {
        return base;
      }
    } catch {
      /* keep looking */
    }
  }
  return present[0]; // none installed yet → first candidate is the install target
}

/** Read the live process into a PathEnv (renderer-safe; falls back sanely when
 *  process/os are unavailable, e.g. mobile). */
export function currentPathEnv(): PathEnv {
  const proc = (
    globalThis as unknown as {
      process?: { platform?: string; env?: Record<string, string | undefined> };
    }
  ).process;
  const env = proc?.env ?? {};
  const platform = (proc?.platform as Platform) ?? "linux";
  const home =
    nonEmpty(env.HOME) ??
    nonEmpty(env.USERPROFILE) ??
    (platform === "win32" ? "C:/Users/Default" : "/root");
  return { platform, env, home };
}
