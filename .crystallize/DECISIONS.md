# Crystallization Decision Register

Append-only. Only `locked` decisions are binding (per DUSA contract).
Scope: `sauce-crm` plugin crystallization run `run-20260526-obsidian-lattice-01`.

---

## DEC-001 — Full crystallization authorized over a healthy, shipping plugin
- **status:** locked
- **date:** 2026-05-26
- **context:** P-001 discovery established the plugin is healthy today (baseline `tsc -noEmit -skipLibCheck` = 0 errors, 101 test files, 575 KB shipping bundle). The contract's full execution (all strict flags → 0 errors, eliminate all `as any`, branded IDs, exhaustiveness sentinels, dev-vault runtime gates) is a multi-session, high-blast-radius refactor.
- **decision:** Operator explicitly chose "Full crystallization" when presented the scope/risk trade-off. Proceed through P-002..P-005 literally.
- **consequence:** Every wave must keep baseline green and the test suite passing (R-019). Nothing commits without G-001..G-007 (GR-002).

## DEC-002 — Repair fleet = Claude `Agent` subagents, NOT the lmswarm/local-LLM router
- **status:** locked
- **date:** 2026-05-26
- **context:** Global multitask-routing rule prefers routing LLM-heavy work through `lmstudio-swarm` / `orc-py`. The crystallization repair work is TypeScript refactoring on a 55k-line working Obsidian plugin where a single bad edit can introduce a runtime regression the test suite won't catch.
- **decision:** Repair subagents are dispatched via the `Agent` tool (contract R-017/R-018 semantics: each receives defect record + files + axiom IDs + verify command; emits repair lines; HALTs on ambiguity). Local small models are not used for repair.
- **rationale:** Contract A-003 names "local agent with shell, file-edit, parallel-spawn" = the orchestrating Claude + its Agent tool. Regression-cost on a shipping plugin exceeds the token savings of local routing. The multitask-routing rule targets *3+ independent sub-projects with a dep table*; this is sequential phases of one refactor.

## DEC-003 — Strict flags rolled out by sequential flip-fix-verify, final state = all-on
- **status:** locked
- **date:** 2026-05-26
- **context:** Flipping all R-003 flags at once yields 629 interacting errors; per-flag marginal counts are noFallthroughCasesInSwitch=0, strict-group=1, strictPropertyInitialization=1, noImplicitThis=1, noImplicitOverride=131, exactOptionalPropertyTypes=121, noUncheckedIndexedAccess=374.
- **decision:** Enable flags in waves (cheapest first), drive each to zero, verify (tsc+tests+build), then enable the next. Terminal `tsconfig.json` carries every R-003 flag. Wave order: W0 free-tier (fallthrough+strict-group+propInit+implicitThis) → W1 noImplicitOverride → W2 exactOptionalPropertyTypes → W3 noUncheckedIndexedAccess.
- **consequence:** Satisfies R-003 end-state while keeping every intermediate commit green and regressions attributable to the in-flight wave.

## DEC-004 — Branded types live in `src/types/`, one constructor + one guard per brand
- **status:** locked
- **date:** 2026-05-26
- **context:** R-006 mandates branded types for file paths, view-type IDs, command IDs, setting keys, plugin IDs, leaf IDs. None exist today; `src/types/` is absent.
- **decision:** Create `src/types/brands.ts` as the single canonical home. Each brand gets exactly one `asX(s: string): X` constructor and one `isX(s): s is X` guard. Existing `string`-typed call sites migrate incrementally; this is P-002/P-003 work tracked in REPAIR_QUEUE.

## DEC-005 — R-004 internal-API casts resolved via central module augmentation
- **status:** locked
- **date:** 2026-05-26
- **context:** The dominant `as any`/`as unknown as` cast class is access to undocumented-but-real Obsidian internal APIs (`app.commands`, `app.setting`, desktop adapter `getBasePath`/`basePath`). Deleting them is wrong (the APIs exist); scattering narrow casts is duplication.
- **decision:** Created `src/types/obsidian-augment.ts` — an ambient `declare module "obsidian"` augmentation giving these internal APIs canonical narrow types. Call sites drop the cast and use the API type-checked. Genuinely-needed remaining casts (rare) keep a one-line rationale comment per R-004.

## DEC-006 — R-006 brands are foundation + incremental adoption (assignable-to-base)
- **status:** locked
- **date:** 2026-05-26
- **context:** Branding every ID call site across 405 files in one shot is high-churn/high-risk. Branded types (`string & Brand<X>`) are assignable TO `string`, so a branded value flows into every existing string consumer unchanged.
- **decision:** `src/types/brands.ts` defines the full brand set + one constructor + one guard each (DEC-004 home). Adoption is applied at canonical ID DEFINITION points (view-type constants, etc.) and proceeds incrementally elsewhere without blocking — un-migrated `string` consumers keep compiling. This satisfies R-006's "constructor + guard per brand" and brands the ID categories at their source of truth.

## DEC-007 — Final concerns run as file-ownership fleet, not concern-ownership
- **status:** locked
- **date:** 2026-05-26
- **context:** R-004/R-005/AX-003/AX-004 overlap on hot files (main.ts, views, services). One-agent-per-concern would put multiple agents on the same file → conflict.
- **decision:** One agent per file-group; each agent resolves EVERY applicable concern within its owned files. Union of all affected files (94) partitioned into 8 conflict-free domain groups (no file split). Foundations (brands.ts, obsidian-augment.ts) are single-owner and imported read-only. Integration gate after: full strict tsc + full suite + production build.

---

> Sub-run `run-20260605-lattice-04x-integration` (0.4.x surface) appended below.
> Continues DEC-### numbering. Existing DEC-001..007 are locked and unedited.

## DEC-008 — Out-of-process daemon owns the single Lance writer; plugin yields on detection
- **status:** locked
- **date:** 2026-06-05
- **context:** 0.4.x adds `sauce-crm-daemon` (`daemon/**`), a standalone Node process exposing an HTTP memory backend (`RoutingMemoryBackend`, `VAULT_HEADER`-routed) over the same out-of-vault LanceDB store the desktop plugin uses (`platformPaths`). Two concurrent writers to one Lance store corrupts it; the daemon exists precisely to let multiple Obsidian windows / headless agents share one store.
- **decision:** The daemon is the single Lance writer when present. `DaemonClient.probeDaemon()` detects a live daemon at plugin boot; on detection `createDaemonBackend()` routes plugin memory ops through the daemon (reusing `BridgeMemoryBackend` + HMAC signer) and the in-process `LanceMemoryBackend` does not open the store for writing. Absent a daemon, the plugin retains in-process ownership. The daemon package is exempt from Obsidian-specific axioms (AX-003/AX-004/R-006 brands) but MUST stay any-free and tsc-clean.
- **consequence:** No two-writer corruption path. AXIS-G is a connected cell, not a defect. isDesktopOnly flips to `true` (Node-builtin/daemon/OS-keychain surface is desktop-only); mobile reach is via the daemon bridge, not in-process. Daemon tsc 0 errors + 0 `any` is a standing gate.

## DEC-009 — App-layer AES-256-GCM transport encryption with HKDF key separation
- **status:** locked
- **date:** 2026-06-05
- **context:** The bridge transport (plugin↔daemon, plugin↔mobile) carries memory payloads over HTTP on the LAN/Tailscale. TLS is not guaranteed on every hop, and the existing HMAC signer authenticates but does not encrypt. Reusing the raw pairing/HMAC secret directly as an encryption key conflates authentication and confidentiality material.
- **decision:** Add an app-layer encryption envelope (`src/bridge/crypto.ts`): AES-256-GCM (`transportEncrypt`/`transportDecrypt`) with the content key derived from the shared secret via HKDF-SHA256 (distinct `info` label → key separation from the HMAC signing key). Contract types `EncEnvelope`/`TransportCipher`/`ENC_HEADER`/`TRANSPORT_ENC_VERSION` version the wire format. GCM auth-tag failure rejects tampered ciphertext; envelope versioning + nonce handling rejects replay.
- **consequence:** Confidentiality is independent of transport TLS. Auth (HMAC) and confidentiality (AES-GCM) use cryptographically separated keys. Tamper + replay are covered by tests (DEF-04x-CRYPTO connected).

## DEC-010 — Whisper spawn policy split: plugin detect-only + hardened execFile; auto-provision is daemon-only
- **status:** locked
- **date:** 2026-06-05
- **context:** Voicenote transcription shells out to `whisper`. Running auto-download/auto-install of a whisper binary or model from inside the Obsidian renderer is both a Restricted-Mode concern and a surprise-side-effect on plugin load. But the daemon (a deliberate, operator-installed Node service) is the right place to provision tooling.
- **decision:** The plugin WhisperEngine is **detect-only** — it locates an existing whisper, never auto-installs — and every spawn goes through `buildWhisperArgs` (pure argv allowlist, no string interpolation) + `execFileNoThrow` (execFile, never a shell), gated by an explicit consent check, written to an audit sink, with a child-process registry that kills in-flight children on plugin unload. **Auto-provision lives only in the daemon** (`daemon/src/transcribe.ts`), which imports the SAME `buildWhisperArgs` + `execFileNoThrow` from the plugin source (no duplication).
- **consequence:** No shell-injection surface; no silent installs in the renderer; argv construction is single-sourced and shared. WhisperEngine hardening (consent + audit + kill-on-unload) is the connected state of DEF-04x-WHISPER.

## DEC-011 — Master password is a Modal with raw listeners (ALLOWED AX-003 exception), not a Component
- **status:** locked
- **date:** 2026-06-05
- **context:** KeyVault master-password unlock (`MasterPasswordModal`, `src/ui/modals/v2/`) needs key/submit DOM handlers. AX-003 requires `register*`-bound listeners on real Obsidian `Component` subclasses, but `Modal` does not extend `Component` and has no `registerDomEvent`.
- **decision:** `MasterPasswordModal extends Modal`; its raw `addEventListener` on `contentEl` is the documented ALLOWED AX-003 exception — `contentEl.empty()` on close removes the listeners. This is NOT a leak and MUST NOT be "fixed" by forcing a Component wrapper.
- **consequence:** Consistent with the locked Modal≠Component carve-out from P-004 (DEC-007 blocked-with-rationale). DEF-04x-MPM is connected.

## DEC-012 — Node builtins use lazy bare-require; a build-conventions test guards it
- **status:** locked
- **date:** 2026-06-05
- **context:** The plugin bundles for the Obsidian Electron *renderer* via esbuild. A 0.4.0 break traced to a STATIC value import of `node:tls` — esbuild resolved/bundled the builtin at module load, breaking the production build and running native requires at load for a default-off feature. tsc, vitest, and eslint all PASS such a static import, so only the production build catches it.
- **decision:** Node builtins MUST be acquired with a LAZY, bare-name require at use-time (`const tls = require("tls") as typeof import("node:tls")`) — the pattern in `MemoryHttpServer`, `Pairing`, `detectLmStudioEndpoint`. Type-only imports (`import type * as tls from "node:tls"`) are fine (erased). `test/build-conventions.test.ts` is the cheap regression gate asserting no static value-import of a node builtin in non-test src.
- **consequence:** The production-build break cannot regress silently — vitest now catches it. DEF-04x-NODEBUILTIN connected; G-002 PASS.

## DEC-013 — Installer detect/consent-installs but does NOT bypass Obsidian Restricted Mode
- **status:** locked
- **date:** 2026-06-05
- **context:** `installer/**` (`install.sh` + `install.ps1`) is a one-line cross-OS installer that detects/consent-installs Obsidian, picks a vault, installs the plugin, and pre-enables it — bundled into the pinnable 0.4.2 release. Obsidian's Restricted Mode (safe mode) is a deliberate user-consent boundary for community plugins.
- **decision:** The installer operates on the vault filesystem (drop plugin files, set the plugin id in `community-plugins.json`) but does NOT programmatically disable Restricted Mode against the user's standing choice beyond the standard pre-enable the user consented to at install time. It is non-TS and exempt from the type axioms, but the Restricted-Mode boundary is treated as a non-negotiable.
- **consequence:** The community-plugin consent model is preserved; the installer is a convenience layer, not a security bypass.

## DEC-014 — Staged release line 0.4.0→0.4.2; master held at 0.3.0 as the submission surface
- **status:** locked
- **date:** 2026-06-05
- **context:** The 0.4.x work shipped across a staged release line (0.4.0 → 0.4.1 → 0.4.2), where 0.4.0 introduced the node:tls bundle break (DEC-012) that subsequent patches fixed. The v0.3.0 crystallized commit 12a4008 on master is the stable, submitted surface; the 0.4.x line is the forward integration branch.
- **decision:** `manifest.json` version is now **0.4.2** on the integration surface, while **master stays at 0.3.0 (12a4008) as the submission anchor**. The G-002 bundle baseline reference remains the **575,339 B v0.3.0 anchor** (NOT a moving 0.4.x baseline) — current `main.js` 629,975 B = +9.50%, well under the +25% ceiling.
- **consequence:** Release provenance is auditable; the bundle-growth gate measures against a fixed anchor, so cumulative 0.4.x growth is always visible against the stable submission point.

## DEC-015 — Full crystallization tagged and released as 0.4.3
- **status:** locked
- **date:** 2026-06-05
- **context:** The crystallization sub-run `run-20260605-lattice-04x-integration` (commit `edf47ed`) folded the entire 0.4.x runtime/installer surface into the lattice (LATTICE_MAP/TEST_MATRIX/DECISIONS DEC-008..014/run.log) but landed on `main` *after* the `0.4.2` tag (`9cb93a3`), leaving the fully-crystallized state untagged. Extends DEC-014 (which recorded the line as 0.4.0→0.4.2).
- **decision:** Tag the crystallized commit as **`0.4.3`** — the first release whose published `main.js` == `main` HEAD and which includes the crystallization seam-repairs (shared `x-sauce-vault` constant, `src/utils/lazyRequire.ts`). `manifest.json`/`package.json`/`versions.json` bumped 0.4.2→0.4.3; installer `PLUGIN_VERSION`/`$PluginVersion` and all user-facing pinned one-liners updated to `0.4.3`. The crystal **bundle anchor stays 575,339 B (v0.3.0)** per DEC-014; `main.js` is unchanged from the crystallization commit (manifest version is not in the bundle) at **629,975 B = +9.50%**. `master` remains at `0.3.0` (12a4008) as the submission surface (DEC-014 unchanged).
- **consequence:** The staged line is now 0.4.0→0.4.3. The latest release == the fully-crystallized `main`; the 0.4.2 release remains valid (its bundle predates only the internal seam-repair, no functional delta). Release provenance auditable; G-001/2/3/7 green at the tagged commit.
