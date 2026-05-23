// MOB-BRIDGE-001 · T-F — TailscaleReachabilityProbe.
//
// Mobile-safe: NO node builtins, no global fetch. The only side-effecting
// dependency is an injected `request` fn (prod binds it to Obsidian
// `requestUrl()`, which bypasses mobile CORS). Probes the desktop bridge
// `/v1/health` route and caches the boolean result for a short TTL so the UI
// can read `lastKnown()` synchronously without re-probing.

import { ReachabilityProbe, ROUTES } from "../../contract";

/** Minimal HTTP surface the probe needs. Defined locally (not in the contract)
 *  so the probe stays storage/transport-agnostic and unit-testable. Prod binds
 *  this to a thin wrapper over Obsidian `requestUrl()`. */
export type HttpRequestFn = (req: {
  url: string;
  method: string;
  headers?: Record<string, string>;
  body?: string;
}) => Promise<{ status: number; json: any; text: string }>;

export interface TailscaleReachabilityProbeDeps {
  /** base origin of the desktop server, e.g. "http://desktop.ts.net:7777". */
  baseUrl: string;
  request: HttpRequestFn;
  /** how long a probe result stays fresh; default 10s. */
  ttlMs?: number;
}

const DEFAULT_TTL_MS = 10_000;

export class TailscaleReachabilityProbe implements ReachabilityProbe {
  private readonly baseUrl: string;
  private readonly request: HttpRequestFn;
  private readonly ttlMs: number;

  private cached: boolean | null = null;
  private cachedAt = 0;

  constructor(deps: TailscaleReachabilityProbeDeps) {
    // Trim a single trailing slash so baseUrl + ROUTES.health never doubles up.
    this.baseUrl = deps.baseUrl.replace(/\/+$/, "");
    this.request = deps.request;
    this.ttlMs = deps.ttlMs ?? DEFAULT_TTL_MS;
  }

  /** True iff the desktop /health answers 2xx with `{ok:true}` within TTL.
   *  Returns a cached value when still fresh. Never throws — any error (network,
   *  parse, timeout) is swallowed to `false`. */
  async isReachable(_timeoutMs?: number): Promise<boolean> {
    const now = Date.now();
    if (this.cached !== null && now - this.cachedAt < this.ttlMs) {
      return this.cached;
    }

    let result = false;
    try {
      const res = await this.request({
        url: this.baseUrl + ROUTES.health,
        method: "GET",
      });
      const status = res?.status ?? 0;
      const ok2xx = status >= 200 && status < 300;
      const bodyOk = res?.json != null && res.json.ok === true;
      result = ok2xx && bodyOk;
    } catch {
      result = false;
    }

    this.cached = result;
    this.cachedAt = Date.now();
    return result;
  }

  /** Last probed value without hitting the network. Null until first probe. */
  lastKnown(): boolean | null {
    return this.cached;
  }
}
