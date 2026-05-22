# Security Architecture

## Threat model

Sauce Graph operates in three concentric trust zones:

1. **The vault itself** — plain markdown. The user's own machine, the user's own Obsidian. No protection beyond filesystem permissions; if an adversary has read access to the vault folder, they have the graph.
2. **Integration credentials and secrets** — OAuth tokens, IMAP passwords, API keys. These are *not* stored in the vault. They live in a separate encrypted store keyed off a master password the user supplies on unlock.
3. **The audit chain** — an append-only HMAC-SHA256 chain over every mutation, optionally pinned to a remote witness via proxy mode.

The threats we explicitly defend against:

- **Token exfiltration via vault sync.** Tokens never touch `.md` files; they live in the KeyVault.
- **Silent mutation.** Every mutation is appended to the audit chain; the chain breaks deterministically if any row is tampered.
- **ReDoS via crafted frontmatter.** No code path constructs a dynamic `RegExp` from user-controlled content (see V1 ReDoS invariant below).

The threats we explicitly *do not* defend against:

- A compromised Obsidian renderer or a malicious community plugin running in the same process.
- An adversary who already has root on the machine.
- Cryptanalysis of AES-256-GCM or HMAC-SHA256.

## KeyVault

Implementation: `src/security/KeyVault.ts`, instantiated in `src/v2-init.ts`.

- **Locked at boot.** The KeyVault holds no key material until the user runs **`Sauce: Unlock Vault`** and types the master password.
- **Key derivation.** The contract calls the KDF `argon2id`, but the shipped implementation routes through **PBKDF2-HMAC-SHA256** with `200_000 × passes` iterations using `window.crypto.subtle.deriveBits`. Real Argon2id requires a native dependency we do not bundle; PBKDF2 with this iteration count is the current shipped KDF. The KDF interface is preserved so a future drop-in of `argon2-browser` (or a WASM Argon2id) does not change call sites. See `makeCryptoBackend()` in `src/v2-init.ts`.
- **Symmetric envelope.** Secrets are sealed with **AES-256-GCM** via WebCrypto. The 12-byte IV is taken from the first 12 bytes of a 16-byte random nonce. `sealAesGcm` and `openAesGcm` in `src/v2-init.ts` are the async primitives; the synchronous `secretboxSeal/Open` on the `CryptoBackend` interface intentionally throw — callers must go through `KeyVault.put/get`.
- **Backing store.** When the V2 SQLite backend is available, secrets live in a `secrets` table (`SqliteSecretStore`). Otherwise they fall back to an encrypted blob in `data.json` (`JsonSecretStore`).
- **Lock semantics.** **`Sauce: Lock Vault`** zeroes the in-memory derived key; pending integration syncs that need a token will fail until unlock.

## Audit chain

Implementation: `src/security/AuditLog.ts`, active only when the SQLite backend is present.

- Every mutation appends a row: `{ts, op, target, actor, payload_hash, prev_hmac, hmac}`.
- `hmac = HMAC-SHA256(masterKeyHmacBytes, prev_hmac || ts || op || target || payload_hash)`.
- The HMAC key is derived from the unlocked master key. **Before unlock**, the chain uses a deterministic bootstrap key (`"sauce-graph-bootstrap-hmac-key-v1-padding-32b"`) so rows can still be written; the verifier walks both spans with the appropriate key. This is documented in `initV2()`.
- **`Sauce: Verify Audit Chain`** walks the entire chain and reports the first broken row (or "verified ✓").

## Proxy mode

Implementation: `src/security/ProxyClient.ts`. Disabled by default.

When enabled, every outbound HTTP request from the plugin (integration syncs, web search, cloud LLM calls) is routed through a configurable proxy URL with an HMAC-signed envelope (`hmacHex(sharedSecret, request)`). Designed for users who want to inspect or pin all plugin egress through their own gateway. Configured at the call site by passing a `ProxyConfig` to `ProxyClient`.

## Scope registry

Implementation: `src/security/ScopeRegistry.ts`. Loaded from `DEFAULT_SCOPES` at boot.

Skills and integrations declare the scopes they need; the runtime denies any request whose declared scope is not in the registry. Useful as a defense-in-depth measure when adding a new skill: you cannot accidentally call an integration whose scope you did not declare.

## V1 ReDoS invariant

A standing invariant from V1 carried forward into V2: **no `RegExp` is ever constructed from user-controlled frontmatter, settings, or LLM output.** The only "pattern" surface in the contract grammar is the `=~` operator in `src/contract/PropositionEvaluator.ts`, which is implemented as a glob with exactly one metasequence (`.+`) and a 200-character cap. The implementation is `matchGlobLiteral`, a hand-written recursive matcher with bounded backtracking. There is no path from a malicious string in frontmatter to a regex compiler.

Any new code that needs a regex must use a hard-coded literal `RegExp(/.../)` — never `new RegExp(userString)`.

## Operator checklist

- [ ] Set a strong master password on first unlock (≥ 16 chars, mixed).
- [ ] Run **`Sauce: Verify Audit Chain`** after any suspicious activity.
- [ ] Rotate keys (**`Sauce: Rotate Keys…`**) on a schedule appropriate to your threat model.
- [ ] Keep the vault's `.obsidian/plugins/sauce-graph/sauce.db` out of any unencrypted backup or sync.
- [ ] If you need real Argon2id, build a fork that pulls in `argon2-browser` and swap `makeCryptoBackend()`; the rest of the system does not change.
