import { describe, it, expect } from "vitest";
import {
  probeDaemon,
  createDaemonBackend,
  daemonBaseUrl,
  makeDaemonFetch,
  DAEMON_DEFAULT_PORT,
  DAEMON_VAULT_HEADER,
  type DaemonFetch,
  type DaemonHealth,
} from "./DaemonClient";
import { sha256Hex, hmacHex } from "../bridge/crypto";
import type { RequestUrlLike } from "../bridge/wiring";

const HEALTH: DaemonHealth = {
  ok: true,
  name: "sauce-crm-daemon",
  version: "0.3.0",
  pid: 1234,
  uptimeMs: 42,
  lance: { available: true, dim: 768 },
};

describe("daemonBaseUrl", () => {
  it("defaults to 127.0.0.1:8788", () => {
    expect(daemonBaseUrl()).toBe(`http://127.0.0.1:${DAEMON_DEFAULT_PORT}`);
  });
  it("honors a custom port", () => {
    expect(daemonBaseUrl(9000)).toBe("http://127.0.0.1:9000");
  });
});

describe("probeDaemon", () => {
  it("returns the health shape on a 200 with our daemon body", async () => {
    const fetchFn: DaemonFetch = async (url) => {
      expect(url).toBe(`http://127.0.0.1:${DAEMON_DEFAULT_PORT}/health`);
      return { status: 200, text: JSON.stringify(HEALTH) };
    };
    const h = await probeDaemon(fetchFn);
    expect(h).toEqual(HEALTH);
  });

  it("returns null on a timeout (fetch resolves null)", async () => {
    const fetchFn: DaemonFetch = async () => null;
    expect(await probeDaemon(fetchFn)).toBeNull();
  });

  it("returns null on connection refused (fetch throws)", async () => {
    const fetchFn: DaemonFetch = async () => {
      throw new Error("ECONNREFUSED");
    };
    expect(await probeDaemon(fetchFn)).toBeNull();
  });

  it("returns null on a non-200 status", async () => {
    const fetchFn: DaemonFetch = async () => ({ status: 503, text: "" });
    expect(await probeDaemon(fetchFn)).toBeNull();
  });

  it("returns null when a foreign server answers (wrong name)", async () => {
    const fetchFn: DaemonFetch = async () => ({
      status: 200,
      text: JSON.stringify({ ok: true, name: "some-other-server" }),
    });
    expect(await probeDaemon(fetchFn)).toBeNull();
  });

  it("returns null on non-JSON body", async () => {
    const fetchFn: DaemonFetch = async () => ({
      status: 200,
      text: "<html>not json</html>",
    });
    expect(await probeDaemon(fetchFn)).toBeNull();
  });

  it("forwards a custom port + timeout", async () => {
    let seenTimeout = -1;
    const fetchFn: DaemonFetch = async (url, opts) => {
      seenTimeout = opts.timeoutMs;
      expect(url).toBe("http://127.0.0.1:9999/health");
      return { status: 200, text: JSON.stringify(HEALTH) };
    };
    await probeDaemon(fetchFn, { port: 9999, timeoutMs: 50 });
    expect(seenTimeout).toBe(50);
  });
});

describe("makeDaemonFetch", () => {
  it("maps a thrown fetch (refused) to null", async () => {
    const fn = makeDaemonFetch(async () => {
      throw new Error("refused");
    });
    expect(await fn("http://x/health", { timeoutMs: 10 })).toBeNull();
  });

  it("returns status + text on success", async () => {
    const fn = makeDaemonFetch(
      async () =>
        ({ status: 200, text: async () => "hello" }) as unknown as Response,
    );
    expect(await fn("http://x/health", { timeoutMs: 10 })).toEqual({
      status: 200,
      text: "hello",
    });
  });
});

describe("createDaemonBackend", () => {
  it("signs requests and injects the x-sauce-vault header", async () => {
    const seen: Array<{ url: string; headers?: Record<string, string> }> = [];
    const requestUrl: RequestUrlLike = async (req) => {
      seen.push({
        url: req.url,
        ...(req.headers ? { headers: req.headers } : {}),
      });
      // Echo a valid search response so the backend resolves.
      return { status: 200, text: JSON.stringify({ hits: [] }) };
    };
    const backend = createDaemonBackend({
      baseUrl: daemonBaseUrl(),
      pairingToken: "deadbeef".repeat(8),
      vaultBasePath: "/home/op/MyVault",
      requestUrl,
      sha256Hex,
      hmacHex,
    });
    expect(backend.mode).toBe("bridge");
    await backend.semanticSearch({ query: "hello", k: 3 });

    expect(seen).toHaveLength(1);
    const call = seen[0]!;
    expect(call.url).toBe(
      `http://127.0.0.1:${DAEMON_DEFAULT_PORT}/v1/memory/search`,
    );
    // Vault-selection header present + signed-request headers present.
    expect(call.headers?.[DAEMON_VAULT_HEADER]).toBe("/home/op/MyVault");
    expect(call.headers?.["x-sauce-sig"]).toMatch(/^[0-9a-f]+$/);
    expect(call.headers?.["x-sauce-nonce"]).toBeTruthy();
    expect(call.headers?.["x-sauce-ts"]).toBeTruthy();
  });

  it("omits the vault header when vaultBasePath is empty", async () => {
    let sawHeader = true;
    const requestUrl: RequestUrlLike = async (req) => {
      sawHeader = DAEMON_VAULT_HEADER in (req.headers ?? {});
      return { status: 200, text: JSON.stringify({ hits: [] }) };
    };
    const backend = createDaemonBackend({
      baseUrl: daemonBaseUrl(),
      pairingToken: "abc123".repeat(10),
      vaultBasePath: "",
      requestUrl,
      sha256Hex,
      hmacHex,
    });
    await backend.recall("x", 1);
    expect(sawHeader).toBe(false);
  });
});
