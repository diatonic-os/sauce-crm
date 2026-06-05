import { describe, it, expect, afterEach } from "vitest";
import { createHash, createHmac } from "node:crypto";
import { BridgeService, type BridgeCrypto } from "./BridgeService";
import type { MemoryBackend } from "../contract";

const crypto: BridgeCrypto = {
  sha256Hex: async (d) => createHash("sha256").update(d).digest("hex"),
  hmacHex: async (k, m) =>
    createHmac("sha256", Buffer.from(k)).update(m).digest("hex"),
};

const backend: MemoryBackend = {
  mode: "lance-desktop",
  semanticSearch: async () => [],
  recall: async () => [],
  embed: async () => null,
  provenance: async () => [],
  ready: async () => true,
};

const lanceStatus = () => "ready" as const;

describe("BridgeService (default-off, gated)", () => {
  let svc: BridgeService;
  afterEach(async () => {
    await svc?.stop();
  });

  it("does not start when disabled", async () => {
    svc = new BridgeService({
      backend,
      crypto,
      lanceStatus,
      discover: async () => "100.64.0.1",
    });
    const st = await svc.start({
      enabled: false,
      port: 0,
      bindHost: "",
      pairingToken: "tok",
    });
    expect(st).toEqual({ running: false, reason: "disabled" });
  });

  it("refuses to start without a pairing token", async () => {
    svc = new BridgeService({
      backend,
      crypto,
      lanceStatus,
      discover: async () => "100.64.0.1",
    });
    const st = await svc.start({
      enabled: true,
      port: 0,
      bindHost: "",
      pairingToken: "",
    });
    expect(st).toEqual({ running: false, reason: "not-paired" });
  });

  it("refuses to start when no Tailscale address can be resolved", async () => {
    svc = new BridgeService({
      backend,
      crypto,
      lanceStatus,
      discover: async () => null,
    });
    const st = await svc.start({
      enabled: true,
      port: 0,
      bindHost: "",
      pairingToken: "tok",
    });
    expect(st).toEqual({ running: false, reason: "no-tailscale" });
  });

  it("starts on an explicit bindHost when enabled + paired, and stops", async () => {
    svc = new BridgeService({ backend, crypto, lanceStatus });
    const st = await svc.start({
      enabled: true,
      port: 0,
      bindHost: "127.0.0.1",
      pairingToken: "tok",
    });
    expect(st.running).toBe(true);
    if (st.running) expect(st.bindHost).toBe("127.0.0.1");
    await svc.stop();
    expect(svc.status().running).toBe(false);
  });

  it("auto-discovers the bind address when not overridden", async () => {
    svc = new BridgeService({
      backend,
      crypto,
      lanceStatus,
      discover: async () => "127.0.0.1",
    });
    const st = await svc.start({
      enabled: true,
      port: 0,
      bindHost: "",
      pairingToken: "tok",
    });
    expect(st.running).toBe(true);
    await svc.stop();
  });
});
