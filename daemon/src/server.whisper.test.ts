// sauce-crm-daemon · /health whisper capability + /v1/transcribe route wiring.
//
// Boots a real loopback DaemonServer with the whisper config + fake fs + mock
// spawn injected, and asserts:
//   - GET /health advertises whisper.available = true when the binary validates,
//   - POST /v1/transcribe is routed to the handler (signed+encrypted round-trip),
//   - whisper.available = false when disabled / binary missing.

import { afterEach, describe, expect, it, vi } from "vitest";

import { DaemonServer } from "./server";
import { VaultRegistry, type OpenVault } from "./vaults";
import type { TranscribeFs } from "./transcribe";
import { TRANSCRIBE_ROUTE } from "./transcribe";
import type { WhisperDaemonConfig } from "./config";
import type {
  MemoryBackend,
  MemoryHit,
  MemoryQuery,
  EmbedResult,
  SignedRequestParts,
} from "../../src/bridge/contract";
import {
  canonicalRequestString,
  SIG_HEADER,
  NONCE_HEADER,
  TS_HEADER,
  ENC_HEADER,
  TRANSPORT_ENC_VERSION,
} from "../../src/bridge/contract";
import {
  sha256Hex,
  hmacHex,
  deriveTransportKey,
  transportEncrypt,
  transportDecrypt,
} from "../../src/bridge/crypto";
import { tokenToKey } from "../../src/bridge/auth";
import type { ProvenanceRecord } from "../../src/services/Provenance";
import type { PathEnv } from "../../src/services/platformPaths";
import type { ExecResult } from "../../src/utils/execFileNoThrow";

const TOKEN = "b".repeat(64);
const ENV: PathEnv = { platform: "linux", env: {}, home: "/home/test" };

class FakeBackend implements MemoryBackend {
  readonly mode = "lance-desktop" as const;
  constructor(public readonly tag: string) {}
  async semanticSearch(_q: MemoryQuery): Promise<MemoryHit[]> {
    return [];
  }
  async recall(): Promise<MemoryHit[]> {
    return [];
  }
  async embed(_t: string, fp: string): Promise<EmbedResult | null> {
    return { fp, dim: 768, cached: false };
  }
  async provenance(): Promise<ProvenanceRecord[]> {
    return [];
  }
  async ready(): Promise<boolean> {
    return true;
  }
}

function fakeRegistry(): VaultRegistry {
  return new VaultRegistry({
    env: ENV,
    requireBase: undefined,
    openVault: async (vaultBasePath: string): Promise<OpenVault> => ({
      vaultBasePath,
      vaultId: vaultBasePath,
      dataDir: `/fake/${vaultBasePath}`,
      memory: new FakeBackend(vaultBasePath),
      lance: {
        embeddingDim: 768,
        async close() {},
      } as unknown as OpenVault["lance"],
    }),
  });
}

function fakeFs(): TranscribeFs {
  return {
    mkdtemp: async (p) => `${p}XXXX`,
    writeFile: async () => {},
    readFile: async () => "loopback transcript",
    rm: async () => {},
    statIsFile: () => true,
    accessExecutable: () => true,
  };
}

const servers: DaemonServer[] = [];
afterEach(async () => {
  while (servers.length) await servers.pop()!.stop();
});

async function boot(
  whisper: WhisperDaemonConfig | undefined,
  fs: TranscribeFs | undefined,
  run?: (
    cmd: string,
    args: string[],
    opts: { timeoutMs: number },
  ) => Promise<ExecResult>,
): Promise<string> {
  const server = new DaemonServer({
    registry: fakeRegistry(),
    pairingToken: TOKEN,
    bindHost: "127.0.0.1",
    port: 0,
    version: "9.9.9",
    defaultVault: () => "/vault/a",
    whisper: () => whisper,
    ...(fs ? { transcribeFs: fs } : {}),
    tmpBase: "/tmp/",
    ...(run ? { transcribeRun: run } : {}),
  });
  servers.push(server);
  const addr = await server.start();
  return `http://127.0.0.1:${addr.port}`;
}

describe("daemon /health whisper capability", () => {
  it("advertises whisper.available = true when enabled + binary validates", async () => {
    const base = await boot(
      { enabled: true, binaryPath: "/usr/bin/whisper" },
      fakeFs(),
    );
    const res = await fetch(`${base}/health`);
    const body = (await res.json()) as { whisper: { available: boolean } };
    expect(body.whisper.available).toBe(true);
  });

  it("advertises whisper.available = false when disabled", async () => {
    const base = await boot({ enabled: false }, fakeFs());
    const res = await fetch(`${base}/health`);
    const body = (await res.json()) as { whisper: { available: boolean } };
    expect(body.whisper.available).toBe(false);
  });

  it("advertises whisper.available = false when the binary is missing", async () => {
    const missingFs: TranscribeFs = { ...fakeFs(), statIsFile: () => false };
    const base = await boot(
      { enabled: true, binaryPath: "/usr/bin/whisper" },
      missingFs,
    );
    const res = await fetch(`${base}/health`);
    const body = (await res.json()) as { whisper: { available: boolean } };
    expect(body.whisper.available).toBe(false);
  });
});

describe("daemon POST /v1/transcribe routing", () => {
  it("routes a signed+encrypted request to the handler and returns text", async () => {
    const run = vi.fn(
      async (
        _c: string,
        _a: string[],
        _o: { timeoutMs: number },
      ): Promise<ExecResult> => ({ code: 0, stdout: "", stderr: "" }),
    );
    const base = await boot(
      { enabled: true, binaryPath: "/usr/bin/whisper" },
      fakeFs(),
      run,
    );

    const key = await tokenToKey(TOKEN, { sha256Hex });
    const aes = await deriveTransportKey(key);
    const payload = JSON.stringify({
      audioBase64: Buffer.from("audio").toString("base64"),
      filename: "n.m4a",
    });
    const data = await transportEncrypt(aes, payload);
    const wire = JSON.stringify({ v: TRANSPORT_ENC_VERSION, data });
    const parts: SignedRequestParts = {
      method: "POST",
      path: TRANSCRIBE_ROUTE,
      bodyHash: await sha256Hex(wire),
      nonce: "n1",
      ts: Date.now(),
    };
    const sig = await hmacHex(key, canonicalRequestString(parts));

    const res = await fetch(`${base}${TRANSCRIBE_ROUTE}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        [SIG_HEADER]: sig,
        [NONCE_HEADER]: parts.nonce,
        [TS_HEADER]: String(parts.ts),
        [ENC_HEADER]: TRANSPORT_ENC_VERSION,
      },
      body: wire,
    });
    expect(res.status).toBe(200);
    const env = (await res.json()) as { data: string };
    const plain = await transportDecrypt(aes, env.data);
    const out = JSON.parse(plain) as { text: string };
    expect(out.text).toBe("loopback transcript");
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("401s an unsigned request to the route", async () => {
    const base = await boot(
      { enabled: true, binaryPath: "/usr/bin/whisper" },
      fakeFs(),
    );
    const res = await fetch(`${base}${TRANSCRIBE_ROUTE}`, {
      method: "POST",
      headers: { [ENC_HEADER]: TRANSPORT_ENC_VERSION },
      body: "{}",
    });
    expect(res.status).toBe(401);
  });
});
