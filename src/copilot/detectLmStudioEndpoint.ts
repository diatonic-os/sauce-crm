// CON-OBS-WIZARD — LM Studio endpoint autodetection. When a user picks LM Studio
// we probe, in order: 127.0.0.1:1234 → localhost:1234 → the host's own LAN IPv4
// address(es):1234. Each probe reuses testProviderConnection (the same catalog
// fetch the picker uses), so a positive detection guarantees the model list will
// also load. Probing the host's *own* IPs is bounded — the host is up, so a
// closed port refuses immediately rather than hanging like a dead-IP subnet
// sweep would. A full cross-machine LAN sweep is intentionally NOT auto-run.

import { Platform } from "obsidian";
import { testProviderConnection } from "./testProviderConnection";
import type { Logger } from "../telemetry";

export const LM_STUDIO_PORT = 1234;

export interface LmStudioDetectResult {
  /** First reachable base URL (e.g. http://127.0.0.1:1234), or null. */
  endpoint: string | null;
  /** Where it was found — for messaging. */
  source: "localhost" | "lan" | null;
  /** Candidates actually probed (for the not-found helper). */
  tried: string[];
}

/** Non-internal IPv4 addresses of the host. Desktop only (Node `os`); returns
 *  [] on mobile or if `os` is unavailable. */
export function hostLanIPv4s(): string[] {
  try {
    if (!Platform.isDesktopApp) return [];
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const os = require("os") as typeof import("node:os");
    const out: string[] = [];
    const ifaces = os.networkInterfaces();
    for (const name of Object.keys(ifaces)) {
      for (const ni of ifaces[name] ?? []) {
        if (ni.family === "IPv4" && !ni.internal && ni.address)
          out.push(ni.address);
      }
    }
    return out;
  } catch {
    return [];
  }
}

/** Ordered, de-duped probe list: localhost first, then the host's LAN IPs. */
export function lmStudioCandidates(): string[] {
  const list = [
    `http://127.0.0.1:${LM_STUDIO_PORT}`,
    `http://localhost:${LM_STUDIO_PORT}`,
    ...hostLanIPv4s().map((ip) => `http://${ip}:${LM_STUDIO_PORT}`),
  ];
  return [...new Set(list)];
}

export async function detectLmStudioEndpoint(opts?: {
  logger?: Logger | null;
  /** Override the probe list (tests / advanced callers). */
  candidates?: string[];
  /** Injectable probe (tests). */
  test?: typeof testProviderConnection;
}): Promise<LmStudioDetectResult> {
  const candidates = opts?.candidates ?? lmStudioCandidates();
  const probe = opts?.test ?? testProviderConnection;
  const tried: string[] = [];
  for (const endpoint of candidates) {
    tried.push(endpoint);
    const r = await probe({
      provider: "lmstudio",
      endpoint,
      logger: opts?.logger ?? null,
    });
    if (r.ok) {
      const isLocal =
        endpoint.includes("127.0.0.1") || endpoint.includes("localhost");
      return { endpoint, source: isLocal ? "localhost" : "lan", tried };
    }
  }
  return { endpoint: null, source: null, tried };
}
