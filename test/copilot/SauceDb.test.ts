// SauceDB paywall gate + hosted sync client.

import { describe, expect, it, vi } from "vitest";
import {
  isLicenseFormatValid,
  mintLicense,
  isSauceDbEntitled,
  canSyncSauceDb,
  SauceDbClient,
  type SauceDbConfig,
} from "../../src/saucebot/SauceDb";

describe("license gate", () => {
  it("accepts a minted (checksum-valid) license, rejects random strings", () => {
    const key = mintLicense("AB12CD34");
    expect(isLicenseFormatValid(key)).toBe(true);
    expect(isLicenseFormatValid("SAUCE-AAAA-BBBB-ZZ")).toBe(false); // bad checksum
    expect(isLicenseFormatValid("not-a-license")).toBe(false);
    expect(isLicenseFormatValid(undefined)).toBe(false);
  });

  it("entitlement requires tier=saucedb AND a valid license", () => {
    const key = mintLicense("AB12CD34");
    expect(isSauceDbEntitled({ tier: "saucedb", license: key })).toBe(true);
    expect(isSauceDbEntitled({ tier: "local", license: key })).toBe(false);
    expect(isSauceDbEntitled({ tier: "saucedb", license: "bogus" })).toBe(
      false,
    );
  });

  it("canSync also requires sync flag + endpoint + tenant", () => {
    const base: SauceDbConfig = {
      tier: "saucedb",
      license: mintLicense("AB12CD34"),
    };
    expect(canSyncSauceDb(base)).toBe(false); // no endpoint/tenant/sync
    expect(
      canSyncSauceDb({
        ...base,
        sync: true,
        endpoint: "https://x",
        tenantId: "t1",
      }),
    ).toBe(true);
  });
});

function cfg(over: Partial<SauceDbConfig> = {}): SauceDbConfig {
  return {
    tier: "saucedb",
    license: mintLicense("AB12CD34"),
    endpoint: "https://brain.saucetech.io",
    tenantId: "tenant-1",
    sync: true,
    ...over,
  };
}

describe("SauceDbClient.syncBrain", () => {
  it("PUTs to /v1/brain/<tenant> with bearer + tenant headers on success", async () => {
    const fetch = vi.fn(async () => ({ status: 200, text: "ok" }));
    const c = new SauceDbClient(cfg(), fetch);
    const r = await c.syncBrain({ manifest: { files: 10 } });
    expect(r.ok).toBe(true);
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe("https://brain.saucetech.io/v1/brain/tenant-1");
    expect(init.method).toBe("PUT");
    expect(init.headers.authorization).toContain("Bearer SAUCE-");
    expect(init.headers["x-sauce-tenant"]).toBe("tenant-1");
  });

  it("does NOT call the network when not entitled", async () => {
    const fetch = vi.fn(async () => ({ status: 200, text: "ok" }));
    const c = new SauceDbClient(cfg({ tier: "local" }), fetch);
    const r = await c.syncBrain({ manifest: {} });
    expect(r.ok).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("surfaces a 403 as a subscription problem", async () => {
    const fetch = vi.fn(async () => ({ status: 403, text: "forbidden" }));
    const c = new SauceDbClient(cfg(), fetch);
    const r = await c.syncBrain({ manifest: {} });
    expect(r.ok).toBe(false);
    expect(r.detail).toContain("subscription");
  });

  it("never throws on a network error (degrades to local-only)", async () => {
    const fetch = vi.fn(async () => {
      throw new Error("ENOTFOUND");
    });
    const c = new SauceDbClient(cfg(), fetch);
    const r = await c.syncBrain({ manifest: {} });
    expect(r.ok).toBe(false);
    expect(r.detail).toContain("unreachable");
  });
});
