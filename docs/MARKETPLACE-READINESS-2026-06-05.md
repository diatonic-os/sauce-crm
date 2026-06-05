# sauce-crm — Obsidian Marketplace Readiness Report

**Date:** 2026-06-05
**Plugin:** sauce-crm (`/home/daclab-ai/Desktop/sauce-graph/plugin`)
**Manifest version:** 0.3.0
**Status:** NOT READY — 2 blockers, 4 high, 11 medium, 9 low (26 findings, post adversarial verification)

---

## 1 · Executive summary

The plugin is functionally mature (tsc clean, 919/919 tests passing, build OK), but it cannot pass Obsidian marketplace review in its current state. Two findings are hard blockers:

1. **MKT-001** — a runtime `npm install` of a native module via `child_process` is a categorical Obsidian Developer Policy violation ("install code outside the reviewed release"); reviewers reject this regardless of the consent modal.
2. **SEC-01** — every cloud-provider API key the user types is persisted in **cleartext** to `data.json`, under UI copy that claims it is "encrypted." This is the headline secret-handling defect for an open-source release.

A cluster of high-severity findings compounds the secret story: the AES-GCM "KeyVault" is **decorative** for the active provider (SEC-02 mirrors the operative key back into plaintext `data.json`), the master-password change/reset/recovery flow is an **unwired placeholder** (SEC-05), and there is **no confirmation re-entry** on first set, so a typo silently provisions an unrecoverable vault (SEC-06). Crypto marketing copy claims Argon2id + libsodium secretbox while the implementation is PBKDF2-SHA256 + AES-GCM (SEC-03).

The `isDesktopOnly: false` manifest value is internally contradicted by the README, code comments, and the hard native/Electron dependencies; it should be `true` (MKT-002, SEC-04, LANCE-002). Release hygiene is incomplete: no `0.3.0` git tag/release exists (MKT-003) and `package.json` is still `0.1.0` (MKT-004).

The LanceDB mirror layer is correct in its source-of-truth model (vault `.md` files are canonical, so index drift is recoverable), but **LANCE-003** is a real concurrency bug: fire-and-forget, unserialized mirror writes race on read-modify-write Lance ops under normal fast typing, producing duplicate tag/edge rows and stale embeddings.

**Recommendation:** ship a desktop-only marketplace build that (a) deletes the runtime npm-install path, (b) routes all provider keys through the existing `CredentialSource`/KeyVault and stops mirroring them to `data.json`, (c) sets `isDesktopOnly: true`, (d) serializes mirror writes, and (e) reconciles version/tag/README hygiene. Wave plan in §4.

---

## 2 · Gate status

| Gate | Result | Notes |
|---|---|---|
| TypeScript compile (`tsc`) | **PASS** | Clean. |
| Test suite | **PASS** | 919/919 passing. |
| Build (`main.js`) | **PASS** | Build OK. |
| Marketplace policy | **FAIL** | Blocked by MKT-001 (runtime install) + secret handling. |

The green build/test gate does **not** imply marketplace readiness — none of the policy/secret findings are caught by the test suite.

---

## 3 · Findings by severity

Severity below is the **adjusted** severity after adversarial verification. The original triage severity is noted where it differs.

### BLOCKER (1)

#### MKT-001 — Runtime `npm install` via `child_process` (policy violation)
- **File:** `src/services/LanceDBInstaller.ts:328` (spawn at 321-328; args assembled 206-209)
- `LanceDBInstaller.install()` spawns `npm install @lancedb/lancedb --prefix <pluginDir>` through Electron `child_process`, fetching and running a native N-API binary from the npm registry **after** the plugin is installed. Obsidian Developer Policies prohibit any "mechanism that updates the plugin" / loads code outside the reviewed release. The consent modal (`LanceDBInstallModal`) does not cure this — running a package manager to download native code at runtime is the canonical auto-reject pattern.
- **Fix:** Delete the runtime npm-install path entirely. The plugin already has a graph-RAG fallback, so the spawn path can be removed. Options: (a) ship a pure-JS/WASM vector backend bundled in `main.js`; (b) make LanceDB a manual, out-of-band desktop install that the plugin only `require()`s if present (never spawns); (c) drop the native dependency for marketplace builds.

> Note: SEC-01 and SEC-02 were triaged "blocker" at intake and down-adjusted to **high** after verification (the keys are real cleartext-at-rest defects but are user-typed secrets in a single-user local file, not a remote exfiltration). They remain release-blocking in practice — see Wave 1.

### HIGH (4)

#### SEC-01 — Provider API keys persisted in plaintext to `data.json` *(intake: blocker)*
- **File:** `src/main.ts:2377` (save); related `src/saucebot/SauceBotRuntime.ts:35`, `loadSettings()` `main.ts:2236-2248`, `saveSettings()` `main.ts:2257-2258`, UI `src/ui/settings/sections/copilot.ts:158-160`
- `SauceGraphSettings.copilot.apiKey` is a plain string written to `data.json` via `saveData(this.settings)`. The settings UI writes the key straight into the tree under copy that says "Stored locally / encrypted" — which is false. Any Anthropic/OpenAI/NIM key ends up cleartext in `<vault>/.obsidian/plugins/sauce-crm/data.json`.
- **Fix:** Stop persisting `copilot.apiKey`. Deep-clone settings and `delete copilot.apiKey` before `saveData`; route the cloud key through the same `CredentialSource` chain the read path uses (`main.ts:560-567`). Correct the UI copy.

#### SEC-02 — KeyVault path is decorative; active key mirrored plaintext into `data.json` *(intake: blocker)*
- **File:** `src/ui/modals/v2/OnboardingWizardModal.ts:141` (also seeds at 369, 484)
- `storeProviderKey()` does `keyVault.put(...)` **and** `settings.copilot.apiKey = key; saveSettings()` — the comment literally says it mirrors the active key "so the runtime can use it today." A user who sets a master password and stores keys in the AES-GCM vault still gets a cleartext copy of the operative key on disk. The vault provides **no** at-rest protection for the active provider, contradicting the manifest's "encrypted KeyVault for OAuth + API keys."
- **Fix:** Remove the plaintext mirror. Have `SauceBotRuntime` resolve the active key on demand via `CredentialSource` (`setCredentialSource` already exists at `main.ts:567`) instead of reading `settings.copilot.apiKey`.

#### LANCE-003 — Vault mirror writes are fire-and-forget; concurrent edits race on read-modify-write Lance ops
- **File:** `src/main.ts:1358` (also 1370, 1377); `src/services/LanceEntityMirror.ts:107-155`; `src/backend/lance/LanceFtsIndex.ts:49`
- `metadataCache 'changed'`, vault `delete`/`rename` all dispatch `void this.mirrorSync?.syncFile(f).catch(()=>{})` — no queue, no per-path mutex. `syncFile` does READ → `mergeInsert` on entities, then **delete-then-add** on tags and edges (non-atomic). Rapid edits to the same note (Obsidian fires `changed` per debounced save) launch overlapping invocations: interleavings can double-insert or drop rows; per-write `optimize()` compounds contention. Vault `.md` files remain source-of-truth, so this is recoverable index drift (hence high, not blocker), but it produces duplicate tag/edge rows and stale embeddings under normal typing.
- **Fix:** Serialize mirror mutations with a per-path (or single global) async queue/mutex in `MirrorSync`, or debounce `syncFile` per path. Replace tags/edges delete-then-add with an atomic `mergeInsert`-style replace.

#### MKT-002 — `isDesktopOnly` mismatch: manifest says `false`, README/code say `true`
- **File:** `manifest.json:9`; contradicted by `README.md:100`, `LanceDBInstaller.ts:6`
- Plugin uses Node `fs`/`path` (`platformPaths.ts`, `SafeStorageCredentialSource.ts`), Electron `safeStorage` + `child_process`, and native `@lancedb/lancedb`. Obsidian requires `isDesktopOnly: true` when Node/Electron APIs are used. The self-contradicting docs will be flagged.
- **Fix:** Set `isDesktopOnly: true` to match README, code comments, and the native-module reality. (Adjusted to **medium** post-verify — the code degrades gracefully on mobile — but the correct value is unambiguously `true`.)
- **Related:** SEC-04, LANCE-002, MKT-003 below.

#### MKT-003 — No GitHub release tag matching manifest version `0.3.0`
- **File:** `manifest.json:3` (tags only `0.1.0`, `0.2.0` exist)
- Obsidian downloads `manifest.json`/`main.js`/`styles.css` from a GitHub release tagged identically to `manifest.version`. With no `0.3.0` release, the automated release check fails.
- **Fix:** Create a release tagged exactly `0.3.0` (no `v` prefix) with `main.js`, `manifest.json`, `styles.css` attached as individual assets (not zipped).
- (Adjusted to **medium** — mechanical fix, but it is a hard submission gate.)

### MEDIUM (11)

#### SEC-03 — AES-GCM nonce 24 bytes generated but only 12 used; crypto docs misrepresent the implementation *(intake: high)*
- **File:** `src/v2-init.ts:58` (also 89); `src/security/KeyVault.ts:1,58`; copy at `OnboardingWizardModal.ts:276`, `SmtpImapPage.ts:208`
- `NONCE_BYTES = 24` but WebCrypto uses `nonce.slice(0,12)`; upper 12 bytes are dead — a latent footgun for a future reviewer assuming 192-bit IV entropy. Docs/UI claim "Argon2id + AES-256-GCM" / "libsodium secretbox" while the real impl is PBKDF2-SHA256 (600k iters) + AES-GCM. PBKDF2-600k is OWASP-acceptable but materially weaker than advertised; the copy is misleading.
- **Fix:** Set `NONCE_BYTES=12`, or use XChaCha20-Poly1305 (libsodium) which supports 24-byte nonces. Reconcile every "Argon2id"/"libsodium secretbox" string with the real PBKDF2+AES-GCM, or ship the claimed Argon2id.

#### SEC-04 — No working secret-storage path on mobile, yet `isDesktopOnly:false` *(intake: high)*
- **File:** `manifest.json:12`; `SafeStorageCredentialSource.ts:79-101`; `main.ts:2289,2344`; `ObsidianOAuthHost.ts:5-6`
- On mobile both encrypted sources are unavailable (no Electron, no native LanceDB), so the **only** functioning secret sink is the plaintext `copilot.apiKey` (SEC-01). Mobile users get cleartext-only keys. The `ObsidianOAuthHost` header still claims "Gated by isDesktopOnly: true" — that gate no longer exists.
- **Fix:** Set `isDesktopOnly:true` (recommended), or implement a mobile-safe encrypted store + mobile secret path. Fix the stale `ObsidianOAuthHost` header comment.

#### SEC-05 — Master-password change/reset/forget flow is an unwired placeholder *(intake: high)*
- **File:** `src/ui/settings/sections/advanced.ts:32`; `SecurityPage.ts` (stub); `KeyVault.ts:169-205`
- The "Manage…" button only fires a `Notice('… placeholder modal.')`. There is no change/reset/forgot path. First `unlock()` on an empty store silently **creates** a vault under whatever password is typed; thereafter a wrong password fails with no recovery. A forgotten master password permanently loses all vault-stored OAuth refresh tokens and non-active keys.
- **Fix:** Implement the manager: change (decrypt-all-under-old, re-encrypt-under-new) and an explicit destructive reset that wipes `api_keys_enc` with a clear confirmation. Wire `SecurityPage`.

#### SEC-06 — Onboarding master password has no confirmation re-entry *(intake: medium)*
- **File:** `OnboardingWizardModal.ts:305` (304-320)
- Single password field, no confirm/re-enter. `unlock()` seals the sentinel under the first password typed, so a typo provisions a vault under an unknown password — and per SEC-05 there is no reset.
- **Fix:** Add a confirm-password field; require a match before `unlock()`. Pairs with SEC-05 reset path.

#### SEC-07 — Bridge `pairingToken` persisted plaintext in `data.json` *(intake: medium)*
- **File:** `src/main.ts:266` (default 356; hashed at 2312); `security/ProxyClient.ts:5`, `v2-init.ts:359`
- `pairingToken` (and `ProxyClient.sharedSecret`) live as plain strings in the persisted settings tree on disk. Same class as SEC-01, lower blast radius (LAN HMAC secret vs cloud key).
- **Fix:** Route both through the credential source / KeyVault, or at minimum document that `data.json` contains these secrets.

#### LANCE-005 — `FtsIndex.ensureIndex` swallows all errors and resets `ensured=false` every call *(intake: medium)*
- **File:** `src/backend/lance/LanceFtsIndex.ts:45` (ensureIndex 27-42, search 67)
- A persistent FTS-index failure is invisible (search silently returns `[]`); resetting `ensured=false` each call forces `listIndices()`/`createIndex()` + per-write `optimize()` on every entity write — version/fragment bloat the maintenance pass exists to fight.
- **Fix:** Log (debounced) on repeated `ensureIndex` failure; don't reset `ensured` every call; batch `optimize()`.

#### LANCE-004 — `addenda` table in schema but never created by `initLanceBackend` *(intake: medium)*
- **File:** `src/backend/lance/index.ts:96` (ensureTable 96-107); `LanceSchema.ts:19`, seed 179-189, predicate 263-265
- `TABLES.addenda` has a seed row + delete predicate and is iterated by `ALL_TABLES`, but `initLanceBackend` never creates it. Tolerated by `openAll` guards, but any direct writer would throw "table not found." Schema-vs-init drift on a first-class vault concept (CLAUDE.md §2.4).
- **Fix:** Add `ensureTable(db, TABLES.addenda, embeddingDim)` if addenda are mirrored, or remove `addenda` from schema if vault-only.

#### PLC-01 — `prompt()`/`window.prompt()`/`window.confirm()` used for input/confirmation *(intake: high)*
- **File:** `src/main.ts:1646`, `src/main.ts:2517`; `src/ui/settings/sections/basic.ts:117,262`
- Blocking browser dialogs are explicitly forbidden by Obsidian guidelines (block the renderer, non-native, unreliable in the mobile Capacitor WebView).
- **Fix:** Replace with Obsidian Modals — reuse existing `src/ui/components/v2/ConfirmModal.ts` and add a small password/text-input modal.

#### PLC-02 — Undocumented private Obsidian APIs (`app.commands`, `app.setting`) in ribbon handlers *(intake: medium)*
- **File:** `src/main.ts:1282` (also 1293,1303,1314,1324,1334,1345-1346)
- `app.commands?.executeCommandById?.(...)` and `app.setting?.open?.()`/`openTabById(...)` are private APIs — a known review flag. Optional-chained (degrades gracefully → medium). Several round-trip to handlers that already exist as direct callbacks.
- **Fix:** Call the underlying methods/modals directly (`this.exportGraphJson()`, `new ImportMappingModal(...).open()`) instead of `executeCommandById`. Opening settings is the only remaining hard-to-avoid private call.

#### MKT-004 — `package.json` version (`0.1.0`) ≠ `manifest.json` (`0.3.0`) *(intake: medium)*
- **File:** `package.json:3`
- Doesn't directly block (Obsidian reads manifest), but breaks `npm version` tooling and signals release-hygiene problems. README also references "24 tests as of 0.1.0" (line 72) — stale.
- **Fix:** Bump `package.json` to `0.3.0`; keep in lockstep via version-bump script; fix stale README references.

#### MKT-005 — Console logging at info/log level on normal load/unload *(intake: medium)*
- **File:** `src/main.ts:1402` (also 2549, 370/373); `src/v2-init.ts:211,251,280`; `src/skills/SkillRuntime.ts:136`
- Obsidian guideline: default console should show only errors. 25 `console.*` calls exist in non-test `src`, several on the default path — contradicting README/CONTRIBUTING ("No console.* in src").
- **Fix:** Gate non-error console output behind a debug setting (default off) or remove it; reserve `console.error/warn` for genuine errors; route info/trace through the in-vault TRACE-LOG.

### LOW (9)

#### SEC-08 — `masterKeyHmacBytes()` returns the raw master key (key-separation hygiene)
- **File:** `src/security/KeyVault.ts:259` (259-262); consumed `AuditLog.ts:52`
- Returns `this.masterKey` directly — the AES-256 data key reused as the audit HMAC key. No disk leak (hence low), but violates key separation; any future consumer holds the full encryption key.
- **Fix:** Derive a distinct HMAC subkey via HKDF (`info='audit-hmac'`); rename the method.

#### PLC-03 — `onunload` fires async teardown without awaiting (HTTP/Lance close not awaited across reload) *(intake: medium)*
- **File:** `src/main.ts:2543` (2546, 2548)
- `void this.bridgeService?.stop()` and `void teardownV2(this.v2)` are not awaited. On rapid disable/re-enable, the listener socket may surface `EADDRINUSE` on port 8787, and LanceDB can briefly double-open. Tolerated (`start` re-stops first) → low.
- **Fix:** Make `onunload` async and `await` both.

#### PLC-04 — In-flight event handlers can write after teardown (no cancellation)
- **File:** `src/main.ts:1352`; `src/services/MirrorSync.ts` (no closed guard)
- An already-dispatched `syncFile`/`runEnrichment` can hit the closed Lance connection post-teardown; harmless only because every call site swallows with `.catch(()=>{})`.
- **Fix:** Add `if (this.unloaded) return` guard (set in `onunload`) and/or a `closed` flag in `MirrorSync`.

#### PLC-05 — `EventBus.emit` has no per-handler error isolation
- **File:** `src/services/EventBus.ts:52` (52-56)
- One throwing subscriber aborts dispatch to the rest and propagates to the emitter.
- **Fix:** Wrap each handler in try/catch and log.

#### LANCE-001 — Per-vault namespace is path-isolated, not table-namespaced
- **File:** `src/services/platformPaths.ts:76` (hash8 103-110, sanitize 80)
- Directory-level isolation per vault; collision only on a 32-bit non-crypto hash of absolute paths — astronomically unlikely for a handful of vaults. Path-traversal not a concern (sanitized prefix is cosmetic; hash is the key). Sound for single-user desktop.
- **Fix (optional):** Widen `hash8` to 53/64-bit or SHA-256 prefix; document isolation is per-OS-user + per-abs-path.

#### LANCE-002 — `isDesktopOnly:false` contradicts native reality; mobile Lance dir resolves to in-vault relative path *(intake: high)*
- **File:** `src/v2-init.ts:225` (vaultBase 185-188, centralDataDir 197); `LanceDBInstaller.ts` header (stale "isDesktopOnly: true")
- Native module never loads on mobile (degrades gracefully). Latent bug: if `getBasePath()` returns falsy, `vaultBase` → `''`, `lanceDir` falls back to `${pluginDir}/data/lancedb` — a vault-relative path `connect()` resolves against `process.cwd()`, an unpredictable location.
- **Fix:** Set `isDesktopOnly:true` (covered by MKT-002) OR guard `initLanceBackend` to refuse when `vaultBase` is empty (never fall back to a relative dataDir). Update the stale `LanceDBInstaller.ts` header.

#### LANCE-006 — Opportunistic compaction at load runs detached (`void`) and can race teardown
- **File:** `src/v2-init.ts:269`; `maintenance.ts:149-157`; teardown `v2-init.ts:379-396`
- `void compactConnection(db)` is unawaited on the same connection the mirror immediately writes to; `teardownV2` calls `close()` without waiting — `close()` can land mid-`optimize`. Bounded (per-table timeout, swallowed failures) → low.
- **Fix:** Track the compaction promise and await/abort it in `teardownV2` before `close()`; defer opportunistic compaction until after the initial resync settles.

#### LANCE-007 — Migration cp+rm fallback reports `failed` when copy succeeds but delete fails
- **File:** `src/services/platformPaths.ts:166` (cp/rm 168-169, return 172)
- EXDEV fallback: if `cp` succeeds but `rm` throws (perms/lock), returns `{migrated:false, reason:'failed'}` though data was copied; v2-init logs "using fresh store" (misleading — central store actually has the data) and the legacy multi-thousand-file in-vault store remains, defeating the migration's whole purpose. No data loss.
- **Fix:** Distinguish "copied-but-cleanup-failed" from "failed": if `cp` succeeded, return `migrated:true` with a warning to manually remove the legacy dir, and surface that to the operator.

#### MKT-006 — README network disclosure inaccurate ("no raw fetch")
- **File:** `README.md:95`; contradicted by `src/saucebot/SauceBotHostAdapters.ts:60`, `src/saucebot/ModelCatalog.ts:127`
- README claims outbound traffic goes "only through Obsidian's requestUrl API (no raw fetch/axios)," but streaming and model-catalog paths use native `fetch()`. Network use itself is disclosed (not a policy violation), but the specific claim is verifiably false.
- **Fix:** Route all outbound through `requestUrl`, or correct the README to state streaming uses native `fetch` where `requestUrl` cannot stream.

---

## 4 · Dep-ordered remediation plan

### Wave 1 — Blockers (must clear before any submission)

| Item | Action | Dependency |
|---|---|---|
| **MKT-001** | Delete the runtime `npm install` / `child_process` spawn in `LanceDBInstaller.ts`. Make LanceDB a `require()`-if-present optional desktop feature; rely on the existing graph-RAG fallback otherwise. | none — do first |
| **SEC-01** | Deep-clone settings and `delete copilot.apiKey` before `saveData`; load the key back via `CredentialSource` (`main.ts:560-567`). Fix "encrypted" UI copy. | feeds SEC-02 |
| **SEC-02** | Remove the plaintext key mirror in `OnboardingWizardModal` (141, 369, 484); have `SauceBotRuntime` resolve the active key via `setCredentialSource`. | depends on SEC-01 credential path |

### Wave 2 — High (gate-blocking in practice)

| Item | Action | Dependency |
|---|---|---|
| **LANCE-003** | Add a per-path async queue/mutex (or per-path debounce) to `MirrorSync.syncFile`; replace tags/edges delete-then-add with atomic `mergeInsert`. | none |
| **MKT-002 / SEC-04 / LANCE-002** | Set `isDesktopOnly: true` in `manifest.json`. Fix stale `ObsidianOAuthHost.ts:5-6` and `LanceDBInstaller.ts:6` header comments. Guard `initLanceBackend` against empty `vaultBase`. | single coordinated change |
| **MKT-003** | Cut a GitHub release tagged exactly `0.3.0` with `main.js`/`manifest.json`/`styles.css` as individual assets. | **last** — after all code fixes land |

### Wave 3 — Medium / Low (review-quality hardening)

| Item | Action |
|---|---|
| **SEC-05 / SEC-06** | Implement master-password manager (change = re-encrypt-all; destructive reset wipes `api_keys_enc` with confirmation); wire `SecurityPage`; add confirm-password field on first set. |
| **SEC-03** | Set `NONCE_BYTES=12` (or move to XChaCha20-Poly1305); reconcile all "Argon2id"/"libsodium secretbox" copy with the real PBKDF2+AES-GCM. |
| **SEC-07 / SEC-08** | Route `pairingToken` + `ProxyClient.sharedSecret` through KeyVault; derive a distinct audit HMAC subkey via HKDF. |
| **PLC-01** | Replace `prompt`/`window.prompt`/`window.confirm` with Obsidian Modals (reuse `ConfirmModal`, add a password-input modal). |
| **PLC-02** | Call underlying methods/modals directly instead of `executeCommandById`. |
| **PLC-03 / PLC-04 / PLC-05** | Make `onunload` async and await teardown; add `unloaded`/`closed` guards; wrap `EventBus.emit` handlers in try/catch. |
| **LANCE-004 / LANCE-005 / LANCE-006 / LANCE-007** | Create the `addenda` table (or remove from schema); stop resetting `ensured` per call + log FTS failures + batch `optimize`; await/abort compaction in teardown; fix migration "copied-but-cleanup-failed" reporting. |
| **MKT-004 / MKT-005 / MKT-006** | Bump `package.json` to `0.3.0`; gate console output behind a debug flag; correct README "no raw fetch" + stale "24 tests as of 0.1.0". |

---

## 5 · Marketplace submission checklist

| Requirement | Status | Note |
|---|---|---|
| `manifest.json` — `id`, `name`, `version`, `minAppVersion` present | PASS | Fields present. |
| `manifest.json` — `isDesktopOnly` correct for API usage | **FAIL** | Says `false`; must be `true` (Node/Electron/native). MKT-002/SEC-04/LANCE-002. |
| `manifest.json` version matches a GitHub release tag | **FAIL** | No `0.3.0` tag; only `0.1.0`/`0.2.0`. MKT-003. |
| Release assets: `main.js` + `manifest.json` + `styles.css` as individual files | **FAIL** | No `0.3.0` release exists. MKT-003. |
| `package.json` version in lockstep with manifest | **FAIL** | `0.1.0` vs `0.3.0`. MKT-004. |
| No runtime download/install of code outside the release | **FAIL** | Runtime `npm install` via `child_process`. MKT-001 (blocker). |
| No plaintext storage of secrets / accurate security claims | **FAIL** | Cleartext keys in `data.json`; "encrypted" copy false; crypto claims misrepresented. SEC-01/02/03/07. |
| No `prompt`/`confirm`/`alert` browser dialogs | **FAIL** | Used in 4 places. PLC-01. |
| Only public Obsidian APIs | **FAIL** | `app.commands`/`app.setting` private APIs. PLC-02. |
| Default console shows only errors | **FAIL** | Info/log on load/unload + skill audits. MKT-005. |
| Network usage disclosed and accurate | **PARTIAL** | Disclosed, but "no raw fetch" claim is false. MKT-006. |
| README accurate (desktop-only, tests, network) | **FAIL** | Contradicts manifest; stale test count. MKT-002/004/006. |
| Clean build / tests / tsc | PASS | 919/919, tsc clean, build OK. |

**Overall submission verdict: FAIL** — clear Wave 1 + Wave 2, then re-run this checklist before submitting.

---

## 6 · Remediation status (applied 2026-06-05, same day)

All findings except MKT-003 (release cut — operator action) were fixed and verified:

| Wave | Items | Status |
|---|---|---|
| 1 | MKT-001, SEC-01, SEC-02 | ✅ FIXED — runtime npm-install deleted (detect-only + manual-install modal); data.json never persists secrets; runtime resolves keys via CredentialSource |
| 2 | LANCE-003, MKT-002/SEC-04/LANCE-002 | ✅ FIXED — MirrorSync per-path serialization w/ coalescing; isDesktopOnly:true; no relative Lance dir fallback |
| 3 | SEC-03/05/06/07/08, PLC-01..05, LANCE-004..007, MKT-004/005/006 | ✅ FIXED — master-password manager + confirm field, HKDF audit subkey, 12-byte nonce (legacy-compat tested), pairingToken redaction, Obsidian modals replace prompt/confirm, async onunload + unload guards, EventBus isolation, addenda table, FTS churn fix, drained compaction, honest migration reporting, versions aligned 0.3.0, console gated, README disclosures rewritten (network incl. groq/openrouter/gemini, whisper local-binary, bridge listener, out-of-vault store) |
| — | MKT-003 | ⏳ PENDING — cut GitHub release tagged `0.3.0` with main.js / manifest.json / styles.css as individual assets |

**Final gates:** tsc clean · vitest 941/941 (158 files; +22 new tests) · eslint 0 errors · production build OK (main.js 595,633 B).
