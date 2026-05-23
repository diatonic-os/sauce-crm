# MOBILE-BRIDGE-SPEC.md

**Program:** `MOB-BRIDGE-001` — Lightweight mobile memory bridge for Sauce CRM
**Status:** spec locked · implementation dispatched (max-parallel worktree agents)
**Owner:** Drew Fortini · **Author:** Claude (Opus 4.7)
**Base commit:** `main` @ keystone (`src/bridge/contract.ts`)

---

## 1. Problem

Sauce CRM's memory/intelligence layer is built on **LanceDB**, a native N-API
module. On Obsidian mobile (iOS/Android, Capacitor WebView) `detectLanceDB()`
returns `mobile-unsupported` (`src/services/LanceDBInstaller.ts:45`) — there is
no Node, no native addon loader. So today, on mobile, every LanceDB-backed
capability (semantic search, memory recall, vector RAG, provenance lookup,
enrichment) is dark.

We do **not** want to port LanceDB to mobile (impossible) or duplicate the
intelligence layer in pure JS (heavy, divergent). We want a **thin mobile
client** that:

1. Uses the markdown vault that **Obsidian Sync already replicates** to the phone.
2. Computes **content fingerprints locally** (Web Crypto — already portable).
3. **Delegates heavy compute** (embeddings, vector search, recall) to the
   desktop plugin over the network, **keyed by fingerprint** so work is
   idempotent and cacheable.
4. **Degrades gracefully offline** to lexical search + a local fingerprint index.

## 2. Key realization (why this is small)

| Layer | Where it lives today | Mobile story |
|---|---|---|
| Content hashing (`sha256Hex`/`hmacHex`) | `Provenance.ts` → `ProvenanceCrypto` (injectable; prod = Web Crypto) | **Already portable** — run as-is on mobile |
| Vault markdown (`_*` folders) | Obsidian Sync | **Already on the phone** |
| Lexical search / backlinks / tags | `SearchService` (core) over Obsidian metadata host | **Already portable** — reuse for offline tier |
| Vector store + provenance store | `src/backend/lance/*` (native) | Desktop-only → **bridge to it** |
| Embeddings | `CopilotRuntime.embed()` via provider | Desktop performs + caches by `fp` |

The **fingerprint `fp = sha256(normalized content)`** (already minted by
`ProvenanceService`, already a content-address with `parentFp` lineage) is the
**universal join key**: mobile and desktop independently compute the *same* `fp`
for the same note, so the bridge ships content **only when `fp` is new**.

## 3. Architecture

```
┌───────────────────────── MOBILE (thin client) ─────────────────────────┐
│ UI · Quick-capture                                                      │
│ ContentHasher        — Web Crypto sha256 (contract: src/bridge/contract)│
│ LocalHashIndex       — fp → {path,title,type,tags,links,mtime}          │
│ LexicalMemoryBackend — offline FTS via existing SearchService           │
│ BridgeMemoryBackend  — requestUrl() RPC, fp-keyed, HMAC-signed, cached  │
│ HybridMemoryBackend  — bridge-when-reachable, else local                │
│ CaptureQueue         — offline writes → markdown → Obsidian Sync        │
└──────────────┬───────────────────────────────────┬─────────────────────┘
               │ Obsidian Sync (markdown, 2-way)     │ HTTP / Tailscale
               │ (already works)                     │ HMAC-signed, fp-keyed RPC
┌──────────────▼───────────────────────────────────▼─────────────────────┐
│                       DESKTOP (heavy, authoritative)                     │
│ MemoryHttpServer  — Node http, bound to Tailscale iface, HMAC-verified  │
│ LanceMemoryBackend — wraps LanceVectorIndex · ProvenanceStore · embed   │
│ LanceDB store (native, full)                                            │
└──────────────────────────────────────────────────────────────────────────┘
```

### 3.1 The bridge contract = content-addressed RPC

All RPC is delta-only and idempotent on `fp`:

| Method | Request | Desktop behavior |
|---|---|---|
| `GET  /v1/memory/by-fp/:fp` | — | Return stored embedding/meta for `fp`, or `404 {unknown:true}` |
| `POST /v1/memory/embed` | `{fp, text, model?}` | Embed (if `fp` unknown), store in LanceDB, return `{fp, dim, cached}` |
| `POST /v1/memory/search` | `{query, k}` | Vector search → `[{path, score, fp, snippet}]` |
| `POST /v1/memory/recall` | `{q, k}` | Memory recall → hits |
| `GET  /v1/provenance/:fp` | — | Provenance lineage records for `fp` |
| `GET  /v1/health` | — | `{ok, version, lance:"ready"|...}` |

Mobile caches every response under `fp`. Unedited note ⇒ unchanged `fp` ⇒ cache
hit ⇒ **zero network**. This is the workload-sharing mechanism: hashing on
mobile, embedding/search on desktop, `fp` makes the hand-off free to repeat.

### 3.2 Transport & security (reuse existing crypto)

- **Server:** Node `http` server, **desktop-only** (same gate precedent as
  `ObsidianOAuthHost`). Bind to the **Tailscale interface only** — never
  `0.0.0.0`, never the public/LAN interface. Configurable host/port; default
  bind `100.64.0.0/10` (Tailscale CGNAT range) address discovered at runtime.
- **Reach:** mobile uses Obsidian `requestUrl()` (bypasses mobile CORS) to
  `http://<tailscale-name-or-ip>:<port>`.
- **Auth:** HMAC over a canonical request string, reusing
  `ProvenanceCrypto.hmacHex` semantics. Pairing token minted on desktop, stored
  in mobile KeyVault. Every request carries
  `X-Sauce-Sig: HMAC(pairingKey, METHOD\nPATH\nSHA256(body)\nNONCE\nTS)`.
  Desktop verifies signature + **rejects stale TS (±300s) and replayed NONCE**
  (LRU nonce cache). No new crypto dependency — same primitive as provenance
  signing.
- **Secure-by-default:** constant-time signature compare; reject unsigned/
  malformed requests with `401`; bind-address allowlist; body size cap; JSON
  parse guarded. (No third-party server framework — Node `http` + our HMAC.)

### 3.3 Offline tier (locked: lexical-first)

When the desktop is unreachable, `HybridMemoryBackend` falls back to
`LexicalMemoryBackend` (existing `SearchService`) + `LocalHashIndex`. Semantic
results are returned with `degraded:true`. Quick-captures are written as
markdown and queued; Obsidian Sync delivers them; the desktop ingests and
back-fills embeddings; mobile pulls fresh results by `fp` next time it is online.
**Deferred (optional later wave, not in this program):** desktop-exported
quantized embedding sidecar for approximate semantic search while desktop is
asleep.

## 4. Decomposition (collision-free parallelism)

**Invariants enforced on every parallel task:**

1. All new code lives under **`src/bridge/**`** — a fresh namespace that does
   **not** intersect the 4 live sibling worktrees (design-system, getting-started,
   modals, sh-h).
2. **No parallel task edits any pre-existing file.** Integration into
   `v2-init.ts` / `main.ts` / settings is done **centrally** post-merge (owner:
   Claude), not by agents.
3. Each task **owns a disjoint subdirectory** and writes **co-located
   `*.test.ts`**.
4. Every task **codes against interfaces in `src/bridge/contract.ts`** (the
   keystone) — never against another task's implementation. Tasks depend on the
   contract, not on each other.
5. If a task needs a contract change, it **reports back** — it must not edit
   `contract.ts` (central-owned to prevent merge divergence).
6. Gate per task: `tsc -noEmit -skipLibCheck` clean **for the task's files** +
   the task's own vitest specs green. Mobile-side tasks must use **no top-level
   Node-builtin imports** (lazy + guarded only) so the bundle stays mobile-load-safe.

### 4.1 Wave 0 — KEYSTONE (sequential, owner: Claude, lands before fan-out)

| ID | Deliverable | Files |
|---|---|---|
| **W0** | Shared contract: `MemoryBackend`, `MemoryHit`, RPC DTOs, `BridgeError`, `AuthSigner`/`AuthVerifier` ifaces, `ContentHasher` iface, `ReachabilityProbe` iface, `canonicalRequestString()` pure helper, version const | `src/bridge/contract.ts`, `src/bridge/index.ts` |

### 4.2 Wave 1 — PARALLEL (6 agents, all depend only on W0)

| ID | Agent | Owns (disjoint) | Builds |
|---|---|---|---|
| **T-A** | desktop-lance-adapter | `src/bridge/desktop/` | `LanceMemoryBackend implements MemoryBackend` — wraps `LanceVectorIndex.query`, `LanceProvenanceStore`, embeddings via injected `embedFn`. Pure adapter, no new logic. |
| **T-B** | desktop-http-server | `src/bridge/server/` | `MemoryHttpServer` — Node `http`, desktop-gated, Tailscale bind, routes §3.1 → injected `MemoryBackend` + `AuthVerifier`. Body cap, JSON guard, error mapping. |
| **T-C** | bridge-auth | `src/bridge/auth/` | `Pairing` (token mint + KeyVault store), `HmacAuthSigner` (mobile), `HmacAuthVerifier` (desktop) w/ nonce LRU + TS window + constant-time compare. Reuses `ProvenanceCrypto`. |
| **T-D** | mobile-bridge-backend | `src/bridge/mobile/bridge/` | `BridgeMemoryBackend implements MemoryBackend` via `requestUrl()`, fp-keyed result cache (injected store iface), signs via `AuthSigner`. |
| **T-E** | mobile-local-index | `src/bridge/mobile/local/` | `LocalHashIndex` (Web Crypto hash of synced markdown, incremental on file events, persisted) + `LexicalMemoryBackend implements MemoryBackend` over existing `SearchService` host iface. |
| **T-F** | mobile-orchestration | `src/bridge/mobile/orchestration/` | `HybridMemoryBackend` (bridge-when-ready else local, `degraded` flag), `TailscaleReachabilityProbe implements ReachabilityProbe`, `CaptureQueue` (offline markdown writes + reconcile hook). |

### 4.3 Wave 2 — INTEGRATION (sequential, owner: Claude, after merge)

| ID | Deliverable |
|---|---|
| **W2** | Wire `HybridMemoryBackend` into `v2-init` behind `Platform.isMobile` + probe; mount `MemoryHttpServer` on desktop behind a setting; pairing UI (desktop shows token, mobile enters it); settings section (bridge URL, enable, status); end-to-end smoke. |

## 5. Dependency graph

```
W0 ──┬── T-A ─┐
     ├── T-B ─┤
     ├── T-C ─┼── W2 (integration)
     ├── T-D ─┤
     ├── T-E ─┤
     └── T-F ─┘
```

W0 blocks all. T-A..T-F are mutually independent (interface-coded). W2 joins.

## 6. Acceptance

- [ ] `tsc -noEmit -skipLibCheck` clean on full tree after merge.
- [ ] `npm run build` exit 0; `main.js` deploys to vaults.
- [ ] Full vitest suite green (existing 501 + new per-task specs).
- [ ] Mobile bundle has no top-level Node import regressions (grep gate).
- [ ] Desktop server binds Tailscale-only; refuses unsigned/replayed/stale.
- [ ] Mobile: bridge path returns semantic hits when desktop reachable; lexical
      `degraded` hits when not; cache hit on unchanged `fp` (no network).
- [ ] Quick-capture offline → markdown queued → Sync → desktop ingest → fp
      back-fill.

## 7. Non-goals

- Porting LanceDB to mobile. Running embeddings on-device. Exposing the server
  to LAN/Internet. Replacing Obsidian Sync for markdown transport. The
  quantized-embedding sidecar (deferred).
