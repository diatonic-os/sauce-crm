// CON-OBS-WIZARD — LM Studio endpoint autodetection. When a user picks LM Studio
// we probe, in order: 127.0.0.1:1234 → localhost:1234 → the host's own LAN IPv4
// address(es):1234. Each probe reuses testProviderConnection (the same catalog
// fetch the picker uses), so a positive detection guarantees the model list will
// also load. Probing the host's *own* IPs is bounded — the host is up, so a
// closed port refuses immediately rather than hanging like a dead-IP subnet
// sweep would. A full cross-machine LAN sweep is intentionally NOT auto-run.

import { Platform, requestUrl } from "obsidian";
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

// ---------------------------------------------------------------------------
// Button-triggered cross-machine LAN sweep. Finds LM Studio on *another* host
// on the same /24(s) as this machine. Bounded (capped host count + concurrency
// + per-host timeout), desktop-only, and two-phase: a fast Node TCP connect
// filters reachable :1234 ports, then an HTTP /v1/models verify confirms it is
// actually LM Studio (not some other service on that port). No shell/exec.
// ---------------------------------------------------------------------------

export interface LanScanProgress {
  scanned: number;
  total: number;
}

export interface LanScanResult {
  endpoint: string | null;
  scanned: number;
  total: number;
}

/** Enumerate the /24 host addresses for each distinct a.b.c subnet of `ips`.
 *  Pure (no `os`) so it is unit-testable; capped to `maxHosts`. */
export function subnetHostsFromIPs(ips: string[], maxHosts = 512): string[] {
  const bases = new Set<string>();
  for (const ip of ips) {
    const m = /^(\d+)\.(\d+)\.(\d+)\.\d+$/.exec(ip);
    if (m) bases.add(`${m[1]}.${m[2]}.${m[3]}`);
  }
  const hosts: string[] = [];
  for (const base of bases) {
    for (let h = 1; h <= 254 && hosts.length < maxHosts; h++) {
      hosts.push(`${base}.${h}`);
    }
  }
  return hosts;
}

/** The host list for a sweep — the /24(s) of this machine's LAN IPv4s.
 *  Empty on mobile (no `os`). */
export function lanSubnetHosts(maxHosts = 512): string[] {
  return subnetHostsFromIPs(hostLanIPv4s(), maxHosts);
}

/** Fast TCP connect probe (desktop, Node `net`). Resolves true if `host:port`
 *  accepts a connection within `timeoutMs`; never throws or hangs. */
function tcpOpen(
  host: string,
  port: number,
  timeoutMs: number,
): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const net = require("net") as typeof import("node:net");
      const sock = net.createConnection({ host, port });
      let done = false;
      const finish = (v: boolean) => {
        if (done) return;
        done = true;
        try {
          sock.destroy();
        } catch {
          /* ignore */
        }
        resolve(v);
      };
      sock.setTimeout(timeoutMs);
      sock.once("connect", () => finish(true));
      sock.once("timeout", () => finish(false));
      sock.once("error", () => finish(false));
    } catch {
      resolve(false);
    }
  });
}

/** Confirm an open `:1234` is LM Studio via GET /v1/models (CORS-free
 *  requestUrl), raced against a timeout. */
async function verifyLmStudio(
  base: string,
  timeoutMs: number,
): Promise<boolean> {
  const url = `${base.replace(/\/+$/, "").replace(/\/v1$/, "")}/v1/models`;
  try {
    const res = await Promise.race([
      requestUrl({ url, method: "GET", throw: false }),
      new Promise<never>((_, rej) =>
        setTimeout(() => rej(new Error("timeout")), timeoutMs),
      ),
    ]);
    const r = res as { status: number; json?: unknown };
    if (r.status !== 200) return false;
    const j = r.json as { data?: unknown } | undefined;
    return !!j && Array.isArray(j.data);
  } catch {
    return false;
  }
}

/** Default per-host probe: TCP connect, then HTTP verify on open ports. */
async function defaultProbe(base: string, timeoutMs: number): Promise<boolean> {
  let host: string;
  try {
    host = new URL(base).hostname;
  } catch {
    return false;
  }
  const open = await tcpOpen(host, LM_STUDIO_PORT, timeoutMs);
  if (!open) return false;
  return verifyLmStudio(base, Math.max(timeoutMs, 1500));
}

/** Sweep the host's LAN /24(s) for LM Studio. Returns the first confirmed
 *  endpoint, or null. Bounded by `concurrency`, `perHostTimeoutMs`, and the
 *  candidate cap. */
export async function scanLanForLmStudio(opts?: {
  concurrency?: number;
  perHostTimeoutMs?: number;
  onProgress?: (p: LanScanProgress) => void;
  /** Test/advanced overrides. */
  hosts?: string[];
  probe?: (base: string, timeoutMs: number) => Promise<boolean>;
}): Promise<LanScanResult> {
  const hosts = opts?.hosts ?? lanSubnetHosts();
  const total = hosts.length;
  const probe = opts?.probe ?? defaultProbe;
  const concurrency = Math.max(1, opts?.concurrency ?? 16);
  const timeout = opts?.perHostTimeoutMs ?? 600;

  let scanned = 0;
  let found: string | null = null;
  let idx = 0;

  const worker = async (): Promise<void> => {
    while (found === null) {
      const i = idx++;
      if (i >= total) return;
      const base = `http://${hosts[i]}:${LM_STUDIO_PORT}`;
      let ok = false;
      try {
        ok = await probe(base, timeout);
      } catch {
        ok = false;
      }
      scanned++;
      opts?.onProgress?.({ scanned, total });
      if (ok && found === null) {
        found = base;
        return;
      }
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(concurrency, total) }, () => worker()),
  );
  return { endpoint: found, scanned, total };
}
