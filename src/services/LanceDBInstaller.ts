// LanceDB capability detector for the Sauce CRM plugin.
//
// LanceDB ships as a native N-API binding and is only loadable on
// desktop Electron — iOS/Android Obsidian runs WebView-only with no
// native module loader. Plugin manifest declares isDesktopOnly: true.
//
// Marketplace policy note (MKT-001): this module previously offered a
// runtime `npm install @lancedb/lancedb` path via child_process. That
// pattern — downloading and installing code outside the reviewed
// release — is prohibited by the Obsidian Developer Policies, so the
// installer was removed entirely (2026-06-05). The plugin now only
// *detects* an existing installation:
//
//   1. Already-resolvable via require() — vector search enabled.
//   2. Not resolvable — graph-RAG fallback (RagAssembler.semantic via
//      fuzzy). The LanceDBInstallModal explains the optional manual,
//      out-of-band install for power users; the plugin never spawns a
//      package manager or downloads code at runtime.

import { resolveNodeRequire } from "../utils/lazyRequire";

export type LanceDBStatus =
  | { state: "available"; version: string }
  | { state: "unavailable"; reason: string }
  | { state: "mobile-unsupported" };

export interface LanceDBCapability {
  status: LanceDBStatus;
  /** True iff the plugin should attempt to USE LanceDB. False means the
   *  caller must use graph-RAG-only mode. */
  enabled: boolean;
  /** True iff the operator has not yet decided. UI surfaces the info
   *  modal iff this is true. */
  awaitingDecision: boolean;
}

/** Pure detection — no install attempts. Returns mobile-unsupported on
 *  any non-Electron host (which has no native module loader).
 *
 *  `pluginDir` (absolute) enables the same resolution fallback `loadLance` uses:
 *  Obsidian's renderer require() resolves from Electron internals and never the
 *  plugin folder, so a bare `require("@lancedb/lancedb")` reports "Cannot find
 *  module" even when a manual install landed it at `<pluginDir>/node_modules`.
 *  We retry by absolute path so detection agrees with what the connection loads. */
export function detectLanceDB(pluginDir?: string): LanceDBStatus {
  const proc = (
    globalThis as unknown as { process?: { versions?: { electron?: string } } }
  ).process;
  if (typeof proc?.versions?.electron !== "string") {
    return { state: "mobile-unsupported" };
  }
  const req = resolveNodeRequire();
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
 *  `lancedb.installDecision`. Retained name/shape for settings
 *  compatibility with pre-0.3.0 data.json files. */
export interface LanceDBInstallDecision {
  /** "approved": user confirmed a manual install (or legacy runtime
   *  install from <0.3.0) — re-detect on load.
   *  "skipped": user clicked "Skip for now".
   *  "pending": no decision yet (initial state). */
  state: "approved" | "skipped" | "pending";
  /** ISO date of the decision (for "remind me later" cadence). */
  decidedAt?: string;
  /** Last detection outcome for transparency. */
  lastAttempt?: { ok: boolean; error?: string; ts: string };
}

export const DEFAULT_LANCEDB_DECISION: LanceDBInstallDecision = {
  state: "pending",
};

/** Aggregator the plugin uses to decide whether to surface the info
 *  modal on onload. */
export function computeCapability(
  decision: LanceDBInstallDecision,
  pluginDir?: string,
): LanceDBCapability {
  const detect = detectLanceDB(pluginDir);
  const detectState = detect.state;
  switch (detectState) {
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
    default: {
      const _exhaustive: never = detectState;
      throw new Error(`unhandled: ${String(_exhaustive)}`);
    }
  }
}
