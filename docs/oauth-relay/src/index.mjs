// Sauce CRM OAuth relay. Express app that holds OAuth client credentials
// and proxies the PKCE flow on behalf of the Sauce CRM Obsidian plugin.
//
// Endpoints:
//   GET  /health
//   POST /authorize/:provider          → { authorize_url, session_id }
//   GET  /callback/:provider           ← provider redirects here with ?code&state
//   GET  /poll/:session_id             → { access_token, expires_at, scopes } (long-poll)
//   POST /refresh/:provider/:sid       → { access_token, expires_at }
//   POST /revoke/:provider/:sid
//
// Bearer auth required on every endpoint except /health and /callback (the
// callback receives the code from the provider; the session_id binds it to
// the prior /authorize call which IS bearer-authenticated).

import express from "express";
import pino from "pino";
import pinoHttp from "pino-http";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { listEnabledProviders, getProvider } from "./providers.mjs";
import { store } from "./store.mjs";

const log = pino({ level: process.env.LOG_LEVEL || "info" });
const app = express();
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: false }));
app.use(pinoHttp({ logger: log, autoLogging: { ignore: (req) => req.url === "/health" } }));

const PORT = Number(process.env.RELAY_PORT || 8787);
const DATA_DIR = process.env.RELAY_DATA_DIR || "./data";

// ---- bearer token bootstrap -------------------------------------------------

async function ensureBearerToken() {
  if (process.env.RELAY_BEARER_TOKEN) return process.env.RELAY_BEARER_TOKEN;
  const tokenPath = path.join(DATA_DIR, "relay-token.txt");
  try {
    const t = (await fs.readFile(tokenPath, "utf8")).trim();
    if (t) return t;
  } catch { /* fallthrough — generate */ }
  await fs.mkdir(DATA_DIR, { recursive: true });
  const t = crypto.randomBytes(32).toString("base64url");
  await fs.writeFile(tokenPath, t + "\n", { mode: 0o600 });
  log.warn({ tokenPath }, "generated new relay bearer token");
  return t;
}

const BEARER = await ensureBearerToken();

function requireBearer(req, res, next) {
  const h = req.headers.authorization || "";
  if (h !== `Bearer ${BEARER}`) {
    return res.status(401).json({ error: "unauthorized" });
  }
  next();
}

// ---- PKCE helpers -----------------------------------------------------------

function b64url(buf) {
  return Buffer.from(buf).toString("base64url");
}

function makeVerifier() {
  return b64url(crypto.randomBytes(32));
}

async function makeChallenge(verifier) {
  return b64url(crypto.createHash("sha256").update(verifier).digest());
}

// ---- routes -----------------------------------------------------------------

app.get("/health", (_req, res) => {
  res.json({ ok: true, providers: listEnabledProviders() });
});

app.post("/authorize/:provider", requireBearer, async (req, res) => {
  const providerName = req.params.provider;
  const p = getProvider(providerName);
  if (!p) return res.status(404).json({ error: `provider ${providerName} not configured` });
  const scopes = Array.isArray(req.body?.scopes) && req.body.scopes.length > 0
    ? req.body.scopes
    : p.defaultScopes;
  const sessionId = b64url(crypto.randomBytes(18));
  const state = b64url(crypto.randomBytes(16));
  const verifier = makeVerifier();
  const challenge = await makeChallenge(verifier);
  await store.putPending(sessionId, { provider: providerName, state, verifier, scopes });

  const params = new URLSearchParams({
    response_type: "code",
    client_id: p.clientId,
    redirect_uri: p.redirectUri,
    scope: scopes.join(" "),
    state: `${sessionId}.${state}`,   // pack session_id + nonce so /callback can resolve
    code_challenge: challenge,
    code_challenge_method: "S256",
    ...p.extraAuthParams,
  });
  res.json({
    authorize_url: `${p.authorizeUrl}?${params.toString()}`,
    session_id: sessionId,
  });
});

app.get("/callback/:provider", async (req, res) => {
  const providerName = req.params.provider;
  const p = getProvider(providerName);
  if (!p) return res.status(404).send(`provider ${providerName} not configured`);
  const { code, state, error, error_description } = req.query;
  if (error) {
    return res.status(400).send(`OAuth error: ${error} ${error_description ?? ""}`);
  }
  if (!code || !state || typeof state !== "string") {
    return res.status(400).send("missing code or state");
  }
  const [sessionId, nonce] = state.split(".", 2);
  const pending = await store.getPending(sessionId);
  if (!pending || pending.state !== nonce || pending.provider !== providerName) {
    return res.status(400).send("session mismatch or expired");
  }

  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: String(code),
    redirect_uri: p.redirectUri,
    code_verifier: pending.verifier,
    client_id: p.clientId,
    client_secret: p.clientSecret,
  });
  try {
    const r = await fetch(p.tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: body.toString(),
    });
    if (!r.ok) {
      const txt = await r.text();
      log.error({ provider: providerName, status: r.status, body: txt.slice(0, 500) }, "token exchange failed");
      return res.status(502).send(`token exchange failed: ${r.status}`);
    }
    const j = await r.json();
    const expiresAt = Date.now() + 1000 * (j.expires_in ?? 3600);
    if (j.refresh_token) {
      await store.putRefresh(providerName, sessionId, j.refresh_token);
    }
    await store.putResult(sessionId, {
      access_token: j.access_token,
      expires_at: expiresAt,
      scopes: (j.scope ?? pending.scopes.join(" ")).split(/\s+/).filter(Boolean),
    });
    await store.delPending(sessionId);
    res.status(200).type("html").send(`<!doctype html><meta charset="utf-8"><title>Sauce CRM relay — connected</title>
<style>body{font:14px/1.4 system-ui;margin:3rem auto;max-width:32rem;text-align:center}h1{font-weight:600}</style>
<h1>Connected — you can close this tab.</h1>
<p>The Sauce CRM plugin will pick up the tokens from the relay momentarily.</p>`);
  } catch (e) {
    log.error({ err: String(e) }, "callback token exchange threw");
    res.status(500).send("internal error");
  }
});

app.get("/poll/:sessionId", requireBearer, async (req, res) => {
  const sessionId = req.params.sessionId;
  const deadline = Date.now() + 5 * 60_000;     // 5-min long-poll
  while (Date.now() < deadline) {
    const result = await store.getResult(sessionId);
    if (result) {
      await store.delResult(sessionId);
      return res.json(result);
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  res.status(408).json({ error: "timeout" });
});

app.post("/refresh/:provider/:sessionId", requireBearer, async (req, res) => {
  const providerName = req.params.provider;
  const sessionId = req.params.sessionId;
  const p = getProvider(providerName);
  if (!p) return res.status(404).json({ error: "provider not configured" });
  const refresh = await store.getRefresh(providerName, sessionId);
  if (!refresh) return res.status(404).json({ error: "no refresh token for session" });
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refresh,
    client_id: p.clientId,
    client_secret: p.clientSecret,
  });
  const r = await fetch(p.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: body.toString(),
  });
  if (!r.ok) {
    const txt = await r.text();
    return res.status(502).json({ error: "refresh failed", detail: txt.slice(0, 200) });
  }
  const j = await r.json();
  if (j.refresh_token) await store.putRefresh(providerName, sessionId, j.refresh_token);
  res.json({
    access_token: j.access_token,
    expires_at: Date.now() + 1000 * (j.expires_in ?? 3600),
    scopes: (j.scope ?? "").split(/\s+/).filter(Boolean),
  });
});

app.post("/revoke/:provider/:sessionId", requireBearer, async (req, res) => {
  const providerName = req.params.provider;
  const sessionId = req.params.sessionId;
  const p = getProvider(providerName);
  if (!p) return res.status(404).json({ error: "provider not configured" });
  const refresh = await store.getRefresh(providerName, sessionId);
  if (refresh && p.revokeUrl) {
    try {
      await fetch(p.revokeUrl, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ token: refresh }).toString(),
      });
    } catch (e) {
      log.warn({ err: String(e) }, "revoke fetch failed; deleting local refresh anyway");
    }
  }
  await store.delRefresh(providerName, sessionId);
  res.json({ ok: true });
});

app.listen(PORT, () => {
  log.info({ port: PORT, providers: listEnabledProviders() }, "OAuth relay listening");
});
