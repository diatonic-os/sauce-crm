// Session store: Redis when REDIS_URL is set (production / docker-compose),
// in-memory Map for dev. Stores ephemeral PKCE state (verifier + scopes +
// session_id mapping) plus refresh tokens long-term per (provider, session_id).

import Redis from "ioredis";

const TTL_SESSION = Number(process.env.RELAY_SESSION_TTL || 900);
const TTL_REFRESH = 60 * 60 * 24 * 90;  // 90 days; provider TTLs may be shorter

class MemoryStore {
  constructor() { this.map = new Map(); }
  async set(key, value, ttlSec) {
    this.map.set(key, value);
    if (ttlSec) setTimeout(() => this.map.delete(key), ttlSec * 1000).unref();
  }
  async get(key) { return this.map.get(key) ?? null; }
  async del(key) { this.map.delete(key); }
}

class RedisStore {
  constructor(url) { this.client = new Redis(url, { lazyConnect: false }); }
  async set(key, value, ttlSec) {
    const v = typeof value === "string" ? value : JSON.stringify(value);
    if (ttlSec) await this.client.set(key, v, "EX", ttlSec);
    else await this.client.set(key, v);
  }
  async get(key) {
    const v = await this.client.get(key);
    if (v === null) return null;
    try { return JSON.parse(v); } catch { return v; }
  }
  async del(key) { await this.client.del(key); }
}

const backend = process.env.REDIS_URL ? new RedisStore(process.env.REDIS_URL) : new MemoryStore();

export const store = {
  /** Stash pending PKCE flow state (verifier + scopes) keyed by session_id. */
  async putPending(sessionId, data) {
    await backend.set(`pending:${sessionId}`, data, TTL_SESSION);
  },
  async getPending(sessionId) {
    return backend.get(`pending:${sessionId}`);
  },
  async delPending(sessionId) {
    await backend.del(`pending:${sessionId}`);
  },

  /** Stash completed token set so /poll can retrieve it. */
  async putResult(sessionId, data) {
    await backend.set(`result:${sessionId}`, data, TTL_SESSION);
  },
  async getResult(sessionId) {
    return backend.get(`result:${sessionId}`);
  },
  async delResult(sessionId) {
    await backend.del(`result:${sessionId}`);
  },

  /** Long-term refresh token per (provider, session_id). */
  async putRefresh(provider, sessionId, refreshToken) {
    await backend.set(`refresh:${provider}:${sessionId}`, refreshToken, TTL_REFRESH);
  },
  async getRefresh(provider, sessionId) {
    return backend.get(`refresh:${provider}:${sessionId}`);
  },
  async delRefresh(provider, sessionId) {
    await backend.del(`refresh:${provider}:${sessionId}`);
  },
};
