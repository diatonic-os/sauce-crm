// SauceDB — the paid "upgrade your brain" tier.
//
// Free tier: the deterministic brain persists as local JSON under _brain/ and
// (when LanceDB is installed) uses the local vector index. SauceDB tier: the
// tenant's brain (crystal digests + path/relationship matrix + embeddings) is
// mirrored into hosted LanceDB running on Sauce's k8s/k3s edge, which the user
// pays for — faster vector search and higher-quality retrieval than a single
// laptop can provide.
//
// This module is the CLIENT-SIDE gate + sync client. The gate here is a soft
// UI lock (format-valid license + tier flag); the HARD entitlement check is
// server-side — the hosted endpoint rejects a sync whose license/tenant the
// billing plane hasn't provisioned. So a forged local flag unlocks the UI but
// cannot actually use the paid backend.

export type BrainTier = "local" | "saucedb";

export interface SauceDbConfig {
  tier: BrainTier;
  /** License key (SAUCE-XXXX-XXXX-CC). Validated for format here, for real
   *  entitlement server-side on sync. */
  license?: string;
  /** Hosted SauceDB endpoint, e.g. https://brain.saucetech.io. */
  endpoint?: string;
  /** Tenant id — isolates this user's brain data in the hosted store. */
  tenantId?: string;
  /** Push the local brain to the hosted edge after each build. */
  sync?: boolean;
}

const LICENSE_RE = /^SAUCE-([0-9A-Z]{4})-([0-9A-Z]{4})-([0-9A-Z]{2})$/;

/** Checksum the license body (the two SAUCE-XXXX-XXXX groups) into 2 base36
 *  chars. A random string won't satisfy this, so it deters casual flag-flips;
 *  it is NOT cryptographic — real validation is server-side. */
export function licenseChecksum(body: string): string {
  let h = 0;
  for (let i = 0; i < body.length; i++) h = (h * 31 + body.charCodeAt(i)) >>> 0;
  return h.toString(36).toUpperCase().padStart(2, "0").slice(-2);
}

export function isLicenseFormatValid(key: string | undefined): boolean {
  if (!key) return false;
  const m = key.trim().toUpperCase().match(LICENSE_RE);
  if (!m) return false;
  return licenseChecksum(`${m[1]}${m[2]}`) === m[3];
}

/** Dev/test helper: mint a format-valid license from a 8-char body. */
export function mintLicense(body8: string): string {
  const b = body8
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, "0")
    .padEnd(8, "0")
    .slice(0, 8);
  return `SAUCE-${b.slice(0, 4)}-${b.slice(4, 8)}-${licenseChecksum(b)}`;
}

/** Soft client gate: tier opted in AND a format-valid license present. */
export function isSauceDbEntitled(cfg: SauceDbConfig | undefined): boolean {
  return !!cfg && cfg.tier === "saucedb" && isLicenseFormatValid(cfg.license);
}

/** Whether a sync can actually be attempted (entitled + endpoint + tenant). */
export function canSyncSauceDb(cfg: SauceDbConfig | undefined): boolean {
  return (
    isSauceDbEntitled(cfg) && !!cfg!.sync && !!cfg!.endpoint && !!cfg!.tenantId
  );
}

export interface SauceDbSyncResult {
  ok: boolean;
  status: number;
  detail: string;
}

/** HTTP seam — Obsidian's requestUrl satisfies this (CORS-bypassing). */
export type SyncFetch = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string },
) => Promise<{ status: number; text: string }>;

/**
 * Pushes the tenant's brain payload to the hosted SauceDB edge. Best-effort and
 * never throws — a failure degrades to local-only operation. The server is the
 * real entitlement gate: it 401/403s an unprovisioned license/tenant.
 */
export class SauceDbClient {
  constructor(
    private cfg: SauceDbConfig,
    private fetch: SyncFetch,
  ) {}

  setConfig(cfg: SauceDbConfig): void {
    this.cfg = cfg;
  }

  async syncBrain(payload: {
    manifest: unknown;
    digests?: Record<string, unknown>;
  }): Promise<SauceDbSyncResult> {
    if (!canSyncSauceDb(this.cfg)) {
      return {
        ok: false,
        status: 0,
        detail: "SauceDB not entitled or not configured.",
      };
    }
    const url = `${this.cfg.endpoint!.replace(/\/+$/, "")}/v1/brain/${encodeURIComponent(this.cfg.tenantId!)}`;
    try {
      const r = await this.fetch(url, {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${this.cfg.license}`,
          "x-sauce-tenant": this.cfg.tenantId!,
        },
        body: JSON.stringify(payload),
      });
      if (r.status >= 200 && r.status < 300) {
        return {
          ok: true,
          status: r.status,
          detail: "Brain synced to SauceDB edge.",
        };
      }
      if (r.status === 401 || r.status === 403) {
        return {
          ok: false,
          status: r.status,
          detail:
            "SauceDB rejected the license/tenant — check your subscription.",
        };
      }
      return {
        ok: false,
        status: r.status,
        detail: `SauceDB sync failed (HTTP ${r.status}).`,
      };
    } catch (e) {
      return {
        ok: false,
        status: 0,
        detail:
          "SauceDB edge unreachable: " +
          (e instanceof Error ? e.message : String(e)),
      };
    }
  }
}
