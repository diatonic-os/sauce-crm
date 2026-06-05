// sauce-crm-daemon · POST /v1/transcribe handler.
//
// The daemon is OUR channel: it MAY provision whisper via its packaging script.
// This route accepts audio bytes from an authenticated, encrypted client and
// returns the transcript text. It reuses the SAME hardened spawn primitives the
// plugin uses — there is exactly one process-spawn path in the codebase:
//
//   - argv is built by buildWhisperArgs (allowlist; no string interpolation),
//   - the binary path is validated (absolute + exists + executable) before spawn,
//   - the spawn goes through execFileNoThrow (execFile, never a shell) with a
//     hard timeout + max output buffer.
//
// Transport: this route enforces the SAME HMAC auth + AES-GCM body encryption
// as the /v1 memory surface, but with its OWN larger body cap (audio is big):
// TRANSCRIBE_MAX_BODY_BYTES (100 MB) instead of the memory routes' 10 MB. The
// request plaintext is JSON { audioBase64, filename?, model?, language? }.

import type { IncomingMessage, ServerResponse } from "node:http";

import {
  execFileNoThrow,
  type ExecResult,
} from "../../src/utils/execFileNoThrow";
import {
  buildWhisperArgs,
  validateBinaryPath,
  type PathProbe,
} from "../../src/services/transcribe/WhisperArgs";
import {
  SIG_HEADER,
  NONCE_HEADER,
  TS_HEADER,
  ENC_HEADER,
  TRANSPORT_ENC_VERSION,
  canonicalRequestString,
  isEncEnvelope,
  type SignedRequestParts,
  type TransportCipher,
} from "../../src/bridge/contract";
import type { AuthVerifier } from "../../src/bridge/contract";
import { sha256Hex } from "../../src/bridge/crypto";
import type { WhisperDaemonConfig } from "./config";

/** Route path (under the shared /v1 prefix the memory routes use). */
export const TRANSCRIBE_ROUTE = "/v1/transcribe";

/** Per-route body cap: 100 MB. Audio payloads are far larger than the memory
 *  routes' 10 MB JSON cap, so this route raises it EXPLICITLY rather than
 *  silently widening the shared MemoryHttpServer cap. */
export const TRANSCRIBE_MAX_BODY_BYTES = 100 * 1024 * 1024;

/** Minimal fs surface the handler needs (injected for unit tests). */
export interface TranscribeFs {
  mkdtemp(prefix: string): Promise<string>;
  writeFile(path: string, data: Buffer): Promise<void>;
  readFile(path: string, enc: "utf8"): Promise<string>;
  rm(path: string, opts: { recursive: boolean; force: boolean }): Promise<void>;
  statIsFile(path: string): boolean;
  accessExecutable(path: string): boolean;
}

export interface TranscribeDeps {
  /** The daemon's whisper config (binaryPath/model/enabled). */
  config: () => WhisperDaemonConfig | undefined;
  /** HMAC verifier (same instance as the memory surface). */
  verifier: AuthVerifier;
  /** Body cipher (same key as the memory surface). Required: this route is
   *  encrypted-only. */
  cipher: TransportCipher;
  /** Filesystem seam. */
  fs: TranscribeFs;
  /** OS tmp dir base. */
  tmpBase: string;
  /** Spawn seam (default execFileNoThrow). */
  run?: (cmd: string, args: string[], opts: { timeoutMs: number }) => Promise<ExecResult>;
  /** Hard spawn timeout (ms). */
  timeoutMs?: number;
  /** Optional structured logger. */
  log?: (entry: Record<string, unknown>) => void;
}

interface TranscribeRequest {
  audioBase64: string;
  filename?: string;
  model?: string;
  language?: string;
}

function header(req: IncomingMessage, name: string): string | null {
  const v = req.headers[name.toLowerCase()];
  if (Array.isArray(v)) return v[0] ?? null;
  return v ?? null;
}

/** True iff this request targets the transcribe route. */
export function isTranscribeRoute(method: string, path: string): boolean {
  return method.toUpperCase() === "POST" && path === TRANSCRIBE_ROUTE;
}

/** Parse + validate the decrypted JSON body. Throws on malformed input. */
export function parseTranscribeBody(plain: string): TranscribeRequest {
  let raw: unknown;
  try {
    raw = JSON.parse(plain);
  } catch {
    throw new Error("body is not valid JSON");
  }
  if (typeof raw !== "object" || raw === null) {
    throw new Error("body must be an object");
  }
  const r = raw as Record<string, unknown>;
  if (typeof r.audioBase64 !== "string" || r.audioBase64.length === 0) {
    throw new Error("missing audioBase64");
  }
  const out: TranscribeRequest = { audioBase64: r.audioBase64 };
  if (typeof r.filename === "string") out.filename = r.filename;
  if (typeof r.model === "string") out.model = r.model;
  if (typeof r.language === "string") out.language = r.language;
  return out;
}

/** A safe extension for the temp audio file, derived from an optional client
 *  filename. We NEVER use the client name as a path component — only its
 *  extension, restricted to an allowlist; everything else falls back to .bin. */
function safeExt(filename: string | undefined): string {
  if (!filename) return "bin";
  const m = /\.([A-Za-z0-9]{1,5})$/.exec(filename);
  const ext = m?.[1]?.toLowerCase() ?? "";
  const allowed = new Set(["m4a", "mp3", "wav", "mp4", "ogg", "flac", "webm", "aac"]);
  return allowed.has(ext) ? ext : "bin";
}

/** The transcribe handler. Reads + caps the body, authenticates + decrypts,
 *  spawns the hardened whisper, returns the transcript. Self-contained so the
 *  DaemonServer only needs to route POST /v1/transcribe here. */
export class TranscribeHandler {
  private readonly run: NonNullable<TranscribeDeps["run"]>;

  constructor(private readonly deps: TranscribeDeps) {
    this.run =
      deps.run ??
      ((cmd, args, opts) => execFileNoThrow(cmd, args, { timeoutMs: opts.timeoutMs }));
  }

  /** Build a PathProbe over the injected fs seam. */
  private probe(): PathProbe {
    return {
      isFile: (p) => this.deps.fs.statIsFile(p),
      isExecutable: (p) => this.deps.fs.accessExecutable(p),
    };
  }

  /** Handle a POST /v1/transcribe request end-to-end. Always responds. */
  async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const cfg = this.deps.config();
    // 503 when the route is not enabled / not configured (clear, not silent).
    if (!cfg || !cfg.enabled) {
      this.fail(res, 503, "whisper transcription not enabled on this daemon");
      return;
    }

    // 1. Read + cap the body (100 MB) BEFORE auth (auth hashes the wire bytes).
    let raw: Buffer;
    try {
      raw = await this.readBody(req, res);
    } catch (e) {
      if (e instanceof BodyTooLarge) return; // already responded + destroyed
      this.fail(res, 400, "could not read request body");
      return;
    }
    const wire = raw.toString("utf8");

    // 2. Encryption is mandatory on this route (audio + transcript are private).
    const encHeader = header(req, ENC_HEADER);
    if (encHeader !== TRANSPORT_ENC_VERSION) {
      this.fail(res, 400, "encryption required (set X-Sauce-Enc: v1)");
      return;
    }

    // 3. Authenticate over the raw wire bytes.
    const auth = await this.authenticate(req, wire);
    if (!auth.ok) {
      this.fail(res, 401, auth.reason);
      return;
    }

    // 4. Decrypt.
    let plain: string;
    try {
      plain = await this.decrypt(wire);
    } catch {
      this.fail(res, 400, "could not decrypt request body");
      return;
    }

    // 5. Parse + validate.
    let body: TranscribeRequest;
    try {
      body = parseTranscribeBody(plain);
    } catch (e) {
      this.fail(res, 400, e instanceof Error ? e.message : "bad request");
      return;
    }

    // 6. Validate the binary (absolute + exists + executable) before spawn.
    const v = validateBinaryPath(cfg.binaryPath, this.probe());
    if (!v.ok) {
      this.fail(res, 503, `whisper binary not runnable: ${v.reason}`);
      return;
    }

    // 7. Decode audio, write to a private temp dir, spawn, read transcript.
    let dir: string | null = null;
    try {
      const audio = Buffer.from(body.audioBase64, "base64");
      dir = await this.deps.fs.mkdtemp(`${this.deps.tmpBase}/sauce-stt-`);
      const ext = safeExt(body.filename);
      const audioPath = `${dir}/audio.${ext}`;
      await this.deps.fs.writeFile(audioPath, audio);

      const args = buildWhisperArgs(audioPath, dir, {
        ...(body.model ? { model: body.model } : {}),
        outputFormat: "txt",
        ...(body.language ? { language: body.language } : {}),
      });

      this.deps.log?.({ ev: "transcribe-spawn", bin: cfg.binaryPath!, args });
      const r = await this.run(cfg.binaryPath!, args, {
        timeoutMs: this.deps.timeoutMs ?? 600_000,
      });
      if (r.code === null) {
        this.fail(res, 500, `whisper unavailable: ${r.error ?? "spawn failed"}`);
        return;
      }
      if (r.code !== 0) {
        this.fail(res, 500, `whisper failed (exit ${r.code}): ${r.stderr || r.error || "unknown"}`);
        return;
      }
      const txtPath = `${dir}/audio.txt`;
      let text: string;
      try {
        text = (await this.deps.fs.readFile(txtPath, "utf8")).trim();
      } catch {
        this.fail(res, 500, "whisper produced no transcript");
        return;
      }
      await this.respond(res, 200, { text, ...(body.language ? { language: body.language } : {}) });
    } catch (e) {
      this.fail(res, 500, e instanceof Error ? e.message : "transcription error");
    } finally {
      // Always scrub the temp dir (audio + transcript are private).
      if (dir) {
        try {
          await this.deps.fs.rm(dir, { recursive: true, force: true });
        } catch {
          /* best-effort cleanup */
        }
      }
    }
  }

  private async authenticate(
    req: IncomingMessage,
    wire: string,
  ): Promise<{ ok: true } | { ok: false; reason: string }> {
    const sig = header(req, SIG_HEADER);
    const nonce = header(req, NONCE_HEADER);
    const tsRaw = header(req, TS_HEADER);
    if (!sig || !nonce || !tsRaw) {
      return { ok: false, reason: "missing-auth-headers" };
    }
    const ts = Number(tsRaw);
    if (!Number.isFinite(ts)) return { ok: false, reason: "bad-timestamp" };
    const parts: SignedRequestParts = {
      method: "POST",
      path: TRANSCRIBE_ROUTE,
      bodyHash: await sha256Hex(wire),
      nonce,
      ts,
    };
    const result = await this.deps.verifier.verify(parts, sig);
    return result.ok ? { ok: true } : { ok: false, reason: result.reason };
  }

  private async decrypt(wire: string): Promise<string> {
    if (wire.length === 0) return "";
    const env = JSON.parse(wire) as unknown;
    if (!isEncEnvelope(env) || env.v !== TRANSPORT_ENC_VERSION) {
      throw new Error("bad envelope");
    }
    return this.deps.cipher.decrypt(env.data);
  }

  /** Encrypt + send a JSON body (responses are encrypted to match the request). */
  private async respond(
    res: ServerResponse,
    status: number,
    body: unknown,
  ): Promise<void> {
    const plain = JSON.stringify(body);
    const data = await this.deps.cipher.encrypt(plain);
    const envelope = JSON.stringify({ v: TRANSPORT_ENC_VERSION, data });
    res.writeHead(status, {
      "Content-Type": "application/json",
      [ENC_HEADER]: TRANSPORT_ENC_VERSION,
    });
    res.end(envelope);
  }

  /** Plaintext error (pre-decrypt failures can't be encrypted; the client
   *  treats a non-2xx with a JSON {error} as a failure regardless). */
  private fail(res: ServerResponse, status: number, reason: string): void {
    if (res.headersSent) {
      res.end();
      return;
    }
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "transcribe-error", reason }));
  }

  /** Read the request body into a Buffer, enforcing the 100 MB cap. On overflow
   *  respond 413 + destroy the socket and throw BodyTooLarge. */
  private readBody(req: IncomingMessage, res: ServerResponse): Promise<Buffer> {
    return new Promise<Buffer>((resolve, reject) => {
      const chunks: Buffer[] = [];
      let size = 0;
      let done = false;
      const finish = (fn: () => void) => {
        if (done) return;
        done = true;
        fn();
      };
      req.on("data", (c: Buffer) => {
        size += c.length;
        if (size > TRANSCRIBE_MAX_BODY_BYTES) {
          finish(() => {
            if (!res.headersSent) {
              res.writeHead(413, { "Content-Type": "application/json" });
              res.end(JSON.stringify({ error: "transcribe-error", reason: "payload too large" }));
            }
            req.destroy();
            reject(new BodyTooLarge());
          });
          return;
        }
        chunks.push(c);
      });
      req.on("end", () => finish(() => resolve(Buffer.concat(chunks))));
      req.on("error", (e) => finish(() => reject(e)));
    });
  }
}

/** Thrown by readBody on cap overflow (socket already destroyed + 413 sent). */
export class BodyTooLarge extends Error {
  constructor() {
    super("payload too large");
    this.name = "BodyTooLarge";
  }
}
