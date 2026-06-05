// sauce-crm-daemon · config specs: first-run mint + 0600 perms, idempotent
// reload (token NOT rotated), override merge, coercion guards.

import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, statSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  loadOrCreateConfig,
  coerceConfig,
  freshConfig,
  DEFAULT_PORT,
  DEFAULT_BIND_HOST,
} from "./config";

const dirs: string[] = [];
function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), "sauce-daemon-cfg-"));
  dirs.push(d);
  return d;
}
afterEach(() => {
  while (dirs.length) {
    const d = dirs.pop()!;
    try {
      rmSync(d, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
  }
});

describe("daemon config", () => {
  it("creates a fresh config with a 64-hex token on first run", async () => {
    const cfgPath = join(tmp(), "daemon", "config.json");
    const { config, created } = await loadOrCreateConfig(cfgPath);
    expect(created).toBe(true);
    expect(config.pairingToken).toMatch(/^[0-9a-f]{64}$/);
    expect(config.port).toBe(DEFAULT_PORT);
    expect(config.bindHost).toBe(DEFAULT_BIND_HOST);
  });

  it("writes the config file mode 0600 (owner-only)", async () => {
    const cfgPath = join(tmp(), "daemon", "config.json");
    await loadOrCreateConfig(cfgPath);
    const mode = statSync(cfgPath).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it("does NOT rotate the token on reload, and applies non-secret overrides", async () => {
    const cfgPath = join(tmp(), "daemon", "config.json");
    const first = await loadOrCreateConfig(cfgPath);
    const second = await loadOrCreateConfig(cfgPath, { port: 9999 });
    expect(second.created).toBe(false);
    expect(second.config.pairingToken).toBe(first.config.pairingToken);
    expect(second.config.port).toBe(9999);
    // On-disk token unchanged.
    const onDisk = JSON.parse(readFileSync(cfgPath, "utf8"));
    expect(onDisk.pairingToken).toBe(first.config.pairingToken);
  });

  it("coerceConfig rejects a config with no pairingToken", () => {
    expect(() => coerceConfig({ port: 1 })).toThrow(/pairingToken/);
    expect(() => coerceConfig(null)).toThrow();
  });

  it("freshConfig is deterministic given an injected token generator", () => {
    const c = freshConfig({ port: 1234 }, () => "deadbeef");
    expect(c.pairingToken).toBe("deadbeef");
    expect(c.port).toBe(1234);
    expect(c.vaults).toEqual([]);
    expect(c.defaultVault).toBeNull();
  });

  it("coerceConfig defaults whisper to absent (disabled) and round-trips it", () => {
    const base = freshConfig({}, () => "tok");
    expect(coerceConfig({ ...base }).whisper).toBeUndefined();
    const withWhisper = coerceConfig({
      ...base,
      whisper: { enabled: true, binaryPath: "/usr/bin/whisper", model: "tiny" },
    });
    expect(withWhisper.whisper).toEqual({
      enabled: true,
      binaryPath: "/usr/bin/whisper",
      model: "tiny",
    });
  });

  it("coerceConfig drops a non-boolean whisper.enabled to false and ignores junk", () => {
    const base = freshConfig({}, () => "tok");
    const c = coerceConfig({
      ...base,
      whisper: { enabled: "yes", binaryPath: 42, model: "" },
    });
    expect(c.whisper).toEqual({ enabled: false });
  });
});
