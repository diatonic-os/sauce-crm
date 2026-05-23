// MOB-BRIDGE-001 · W2 — desktop bridge lifecycle. Owns the MemoryHttpServer:
// resolves the bind address (operator override → Tailscale auto-discovery),
// derives the HMAC verification key from the pairing token, builds the verifier,
// and start/stops the server. Default-OFF: start() is a no-op unless enabled,
// and refuses to bind without both a Tailscale address and a pairing token.

import type { MemoryBackend } from "../contract";
import { HmacAuthVerifier, tokenToKey } from "../auth";
import { MemoryHttpServer } from "./MemoryHttpServer";
import { discoverTailscaleAddress } from "./Tailscale";

export interface BridgeServerConfig {
  enabled: boolean;
  port: number;
  /** Explicit bind address; "" → auto-discover the Tailscale IPv4. */
  bindHost: string;
  /** Pairing token (hex). "" → not paired; server will not start. */
  pairingToken: string;
}

export type BridgeStatus =
  | { running: true; bindHost: string; port: number }
  | { running: false; reason: "disabled" | "no-tailscale" | "not-paired" | "error"; detail?: string };

export interface BridgeCrypto {
  hmacHex(key: Uint8Array, msg: string): Promise<string>;
  sha256Hex(data: string): Promise<string>;
}

export class BridgeService {
  private server: MemoryHttpServer | null = null;
  private last: BridgeStatus = { running: false, reason: "disabled" };

  constructor(
    private readonly deps: {
      backend: MemoryBackend;
      crypto: BridgeCrypto;
      lanceStatus: () => "ready" | "installing" | "missing" | "error";
      /** override discovery in tests. */
      discover?: () => Promise<string | null>;
    },
  ) {}

  status(): BridgeStatus {
    return this.last;
  }

  /** Idempotent: stops any running server, then starts a fresh one if the
   *  config allows. Returns the resulting status (never throws). */
  async start(cfg: BridgeServerConfig): Promise<BridgeStatus> {
    await this.stop();
    if (!cfg.enabled) return (this.last = { running: false, reason: "disabled" });
    if (!cfg.pairingToken) return (this.last = { running: false, reason: "not-paired" });

    const bindHost = cfg.bindHost || (await (this.deps.discover ?? discoverTailscaleAddress)());
    if (!bindHost) return (this.last = { running: false, reason: "no-tailscale" });

    try {
      const key = await tokenToKey(cfg.pairingToken, { sha256Hex: this.deps.crypto.sha256Hex });
      const verifier = new HmacAuthVerifier(
        { hmacHex: this.deps.crypto.hmacHex },
        async () => key,
      );
      const server = new MemoryHttpServer({
        backend: this.deps.backend,
        verifier,
        bindHost,
        port: cfg.port,
        lanceStatus: this.deps.lanceStatus,
      });
      await server.start();
      this.server = server;
      return (this.last = { running: true, bindHost, port: cfg.port });
    } catch (e) {
      return (this.last = { running: false, reason: "error", detail: String(e) });
    }
  }

  async stop(): Promise<void> {
    if (this.server) {
      try {
        await this.server.stop();
      } catch {
        /* best-effort */
      }
      this.server = null;
    }
    if (this.last.running) this.last = { running: false, reason: "disabled" };
  }
}
