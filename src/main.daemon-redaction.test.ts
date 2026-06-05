// SEC-07: the daemon pairing token (like the bridge token + copilot key) is a
// shared secret and MUST NOT land in data.json. The full plugin module cannot be
// imported in a unit test (it transitively pulls Svelte + many Obsidian-only
// classes), so this asserts the exact redaction transform saveSettings() applies
// and the chain-mirror service id it uses. Keep this in lockstep with
// src/main.ts saveSettings().

import { describe, it, expect, vi } from "vitest";

interface Settings {
  copilot: { provider: string; apiKey: string };
  bridge?: { enabled: boolean; pairingToken: string };
  daemon?: { enabled: boolean; port: number; pairingToken: string };
}

/** Faithful mirror of saveSettings()'s redaction clone (SEC-01 + SEC-07). */
function redact(settings: Settings): Settings {
  return {
    ...settings,
    copilot: { ...settings.copilot, apiKey: "" },
    ...(settings.bridge
      ? { bridge: { ...settings.bridge, pairingToken: "" } }
      : {}),
    ...(settings.daemon
      ? { daemon: { ...settings.daemon, pairingToken: "" } }
      : {}),
  };
}

/** Mirror of saveSettings()'s chain-sync for the daemon token. */
async function mirrorDaemonToken(
  settings: Settings,
  chain: { put: (service: string, value: string) => Promise<void> },
  daemonPairingService: () => string,
): Promise<void> {
  const dtok = settings.daemon?.pairingToken;
  if (dtok) {
    await chain.put(daemonPairingService(), dtok).catch(() => {});
  }
}

describe("SEC-07 daemon token redaction", () => {
  const base: Settings = {
    copilot: { provider: "openai", apiKey: "SECRET-COPILOT-KEY" },
    bridge: { enabled: true, pairingToken: "BRIDGE-TOKEN" },
    daemon: { enabled: true, port: 8788, pairingToken: "DAEMON-TOKEN" },
  };

  it("strips all three secrets from the persisted clone", () => {
    const r = redact(base);
    expect(r.daemon?.pairingToken).toBe("");
    expect(r.bridge?.pairingToken).toBe("");
    expect(r.copilot.apiKey).toBe("");
    // In-memory settings are untouched (session copy survives).
    expect(base.daemon?.pairingToken).toBe("DAEMON-TOKEN");
  });

  it("mirrors the daemon token into the chain under daemon:pairing-token", async () => {
    const put = vi.fn(async () => {});
    await mirrorDaemonToken(base, { put }, () => "daemon:pairing-token");
    expect(put).toHaveBeenCalledWith("daemon:pairing-token", "DAEMON-TOKEN");
  });

  it("does not write an empty token to the chain", async () => {
    const put = vi.fn(async () => {});
    const noTok: Settings = {
      ...base,
      daemon: { enabled: true, port: 8788, pairingToken: "" },
    };
    await mirrorDaemonToken(noTok, { put }, () => "daemon:pairing-token");
    expect(put).not.toHaveBeenCalled();
  });
});
