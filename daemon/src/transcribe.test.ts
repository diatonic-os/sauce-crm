// sauce-crm-daemon · POST /v1/transcribe handler specs.
//
// Drives TranscribeHandler.handle over a fake IncomingMessage/ServerResponse,
// a fake fs seam, and a mock spawn — no real whisper, no real socket. Auth +
// encryption use the REAL HMAC verifier + AES-GCM cipher (pairing round-trip).

import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";

import {
  TranscribeHandler,
  parseTranscribeBody,
  isTranscribeRoute,
  TRANSCRIBE_ROUTE,
  type TranscribeFs,
} from "./transcribe";
import { HmacAuthVerifier, tokenToKey } from "../../src/bridge/auth";
import {
  sha256Hex,
  hmacHex,
  deriveTransportKey,
  transportEncrypt,
  transportDecrypt,
} from "../../src/bridge/crypto";
import {
  SIG_HEADER,
  NONCE_HEADER,
  TS_HEADER,
  ENC_HEADER,
  TRANSPORT_ENC_VERSION,
  canonicalRequestString,
  type SignedRequestParts,
  type TransportCipher,
} from "../../src/bridge/contract";
import type { ExecResult } from "../../src/utils/execFileNoThrow";
import type { WhisperDaemonConfig } from "./config";

const TOKEN = "f".repeat(64);

async function makeCipher(): Promise<TransportCipher> {
  const key = await tokenToKey(TOKEN, { sha256Hex });
  const aes = await deriveTransportKey(key);
  return {
    encrypt: (pt) => transportEncrypt(aes, pt),
    decrypt: (wire) => transportDecrypt(aes, wire),
  };
}

function makeVerifier(): HmacAuthVerifier {
  return new HmacAuthVerifier({ hmacHex }, async () =>
    tokenToKey(TOKEN, { sha256Hex }),
  );
}

/** Build the signed + encrypted wire body + headers a real client would send. */
async function signedRequest(
  payload: object,
  cipher: TransportCipher,
  overrides?: { sig?: string; omitAuth?: boolean },
): Promise<{ wire: string; headers: Record<string, string> }> {
  const data = await cipher.encrypt(JSON.stringify(payload));
  const wire = JSON.stringify({ v: TRANSPORT_ENC_VERSION, data });
  const key = await tokenToKey(TOKEN, { sha256Hex });
  const parts: SignedRequestParts = {
    method: "POST",
    path: TRANSCRIBE_ROUTE,
    bodyHash: await sha256Hex(wire),
    nonce: "nonce-" + Math.random().toString(16).slice(2),
    ts: Date.now(),
  };
  const sig = overrides?.sig ?? (await hmacHex(key, canonicalRequestString(parts)));
  const headers: Record<string, string> = overrides?.omitAuth
    ? { [ENC_HEADER]: TRANSPORT_ENC_VERSION }
    : {
        [SIG_HEADER]: sig,
        [NONCE_HEADER]: parts.nonce,
        [TS_HEADER]: String(parts.ts),
        [ENC_HEADER]: TRANSPORT_ENC_VERSION,
      };
  return { wire, headers };
}

/** A fake req that emits the body as one chunk. */
function fakeReq(wire: string, headers: Record<string, string>): EventEmitter {
  const req = new EventEmitter() as EventEmitter & {
    headers: Record<string, string>;
    method: string;
    url: string;
    destroy: () => void;
  };
  req.headers = headers;
  req.method = "POST";
  req.url = TRANSCRIBE_ROUTE;
  req.destroy = () => {};
  queueMicrotask(() => {
    req.emit("data", Buffer.from(wire, "utf8"));
    req.emit("end");
  });
  return req;
}

interface FakeRes {
  status: number | null;
  headers: Record<string, string>;
  body: string;
  headersSent: boolean;
  writeHead(s: number, h?: Record<string, string>): void;
  end(b?: string): void;
}
function fakeRes(): FakeRes {
  return {
    status: null,
    headers: {},
    body: "",
    headersSent: false,
    writeHead(s, h) {
      this.status = s;
      if (h) this.headers = { ...this.headers, ...h };
      this.headersSent = true;
    },
    end(b) {
      if (b) this.body = b;
    },
  };
}

function fakeFs(transcript: string): TranscribeFs {
  return {
    mkdtemp: async (prefix) => `${prefix}XXXX`,
    writeFile: async () => {},
    readFile: async () => transcript,
    rm: vi.fn(async () => {}),
    statIsFile: () => true,
    accessExecutable: () => true,
  };
}

const ENABLED: WhisperDaemonConfig = {
  enabled: true,
  binaryPath: "/usr/bin/whisper",
  model: "large-v3-turbo",
};

describe("isTranscribeRoute / parseTranscribeBody", () => {
  it("matches only POST /v1/transcribe", () => {
    expect(isTranscribeRoute("POST", TRANSCRIBE_ROUTE)).toBe(true);
    expect(isTranscribeRoute("GET", TRANSCRIBE_ROUTE)).toBe(false);
    expect(isTranscribeRoute("POST", "/v1/memory/search")).toBe(false);
  });

  it("requires audioBase64", () => {
    expect(() => parseTranscribeBody("{}")).toThrow(/audioBase64/);
    expect(() => parseTranscribeBody("not json")).toThrow(/JSON/);
    expect(parseTranscribeBody('{"audioBase64":"AAAA"}').audioBase64).toBe("AAAA");
  });
});

describe("TranscribeHandler.handle", () => {
  it("503s when whisper is disabled", async () => {
    const cipher = await makeCipher();
    const h = new TranscribeHandler({
      config: () => ({ enabled: false }),
      verifier: makeVerifier(),
      cipher,
      fs: fakeFs("x"),
      tmpBase: "/tmp/",
    });
    const { wire, headers } = await signedRequest({ audioBase64: "AAAA" }, cipher);
    const res = fakeRes();
    await h.handle(fakeReq(wire, headers) as never, res as never);
    expect(res.status).toBe(503);
  });

  it("401s a request with no auth headers", async () => {
    const cipher = await makeCipher();
    const h = new TranscribeHandler({
      config: () => ENABLED,
      verifier: makeVerifier(),
      cipher,
      fs: fakeFs("x"),
      tmpBase: "/tmp/",
    });
    const { wire, headers } = await signedRequest(
      { audioBase64: "AAAA" },
      cipher,
      { omitAuth: true },
    );
    const res = fakeRes();
    await h.handle(fakeReq(wire, headers) as never, res as never);
    expect(res.status).toBe(401);
  });

  it("401s a request with a bad signature", async () => {
    const cipher = await makeCipher();
    const h = new TranscribeHandler({
      config: () => ENABLED,
      verifier: makeVerifier(),
      cipher,
      fs: fakeFs("x"),
      tmpBase: "/tmp/",
    });
    const { wire, headers } = await signedRequest(
      { audioBase64: "AAAA" },
      cipher,
      { sig: "deadbeef" },
    );
    const res = fakeRes();
    await h.handle(fakeReq(wire, headers) as never, res as never);
    expect(res.status).toBe(401);
  });

  it("400s when encryption header is absent", async () => {
    const cipher = await makeCipher();
    const h = new TranscribeHandler({
      config: () => ENABLED,
      verifier: makeVerifier(),
      cipher,
      fs: fakeFs("x"),
      tmpBase: "/tmp/",
    });
    const { wire, headers } = await signedRequest({ audioBase64: "AAAA" }, cipher);
    delete headers[ENC_HEADER];
    const res = fakeRes();
    await h.handle(fakeReq(wire, headers) as never, res as never);
    expect(res.status).toBe(400);
  });

  it("transcribes a valid signed+encrypted request and returns encrypted text", async () => {
    const cipher = await makeCipher();
    const run = vi.fn(
      async (
        _cmd: string,
        _args: string[],
        _opts: { timeoutMs: number },
      ): Promise<ExecResult> => ({ code: 0, stdout: "", stderr: "" }),
    );
    const fs = fakeFs("the daemon transcript");
    const h = new TranscribeHandler({
      config: () => ENABLED,
      verifier: makeVerifier(),
      cipher,
      fs,
      tmpBase: "/tmp/",
      run,
    });
    const audio = Buffer.from("fake audio bytes").toString("base64");
    const { wire, headers } = await signedRequest(
      { audioBase64: audio, filename: "note.m4a", language: "en" },
      cipher,
    );
    const res = fakeRes();
    await h.handle(fakeReq(wire, headers) as never, res as never);

    expect(res.status).toBe(200);
    expect(res.headers[ENC_HEADER]).toBe(TRANSPORT_ENC_VERSION);
    // The body is an encrypted envelope; decrypt + parse it.
    const env = JSON.parse(res.body) as { data: string };
    const plain = await cipher.decrypt(env.data);
    const out = JSON.parse(plain) as { text: string; language?: string };
    expect(out.text).toBe("the daemon transcript");
    expect(out.language).toBe("en");
    // The spawn used the configured absolute binary + the audio path as argv[0].
    expect(run).toHaveBeenCalledTimes(1);
    expect(run.mock.calls[0]![0]).toBe("/usr/bin/whisper");
    expect(run.mock.calls[0]![1][0]).toMatch(/audio\.m4a$/);
    // Temp dir scrubbed.
    expect(fs.rm).toHaveBeenCalled();
  });

  it("503s when the configured binary fails validation", async () => {
    const cipher = await makeCipher();
    const fs: TranscribeFs = { ...fakeFs("x"), statIsFile: () => false };
    const h = new TranscribeHandler({
      config: () => ENABLED,
      verifier: makeVerifier(),
      cipher,
      fs,
      tmpBase: "/tmp/",
    });
    const { wire, headers } = await signedRequest({ audioBase64: "AAAA" }, cipher);
    const res = fakeRes();
    await h.handle(fakeReq(wire, headers) as never, res as never);
    expect(res.status).toBe(503);
  });

  it("500s when whisper exits non-zero", async () => {
    const cipher = await makeCipher();
    const run = async (): Promise<ExecResult> => ({
      code: 2,
      stdout: "",
      stderr: "boom",
    });
    const h = new TranscribeHandler({
      config: () => ENABLED,
      verifier: makeVerifier(),
      cipher,
      fs: fakeFs("x"),
      tmpBase: "/tmp/",
      run,
    });
    const { wire, headers } = await signedRequest({ audioBase64: "AAAA" }, cipher);
    const res = fakeRes();
    await h.handle(fakeReq(wire, headers) as never, res as never);
    expect(res.status).toBe(500);
  });
});
