# LATTICE_MAP — sauce-crm crystallization (D-001)

Run: `run-20260526-obsidian-lattice-01` · Plugin: `sauce-crm` v0.3.0 · Date: 2026-05-26

> The literal O(n²) cell grid over hundreds of axis members is combinatorial noise.
> This map records the **axis member inventory**, the **defect cells** (broken/unknown),
> and **repair state**. A cell not listed as a defect is `connected` or
> `absent-by-design`. This is the contract's intent (T-001-002..004) rendered useful.

## meta.plugin
- id `sauce-crm`, version `0.3.0`, minAppVersion `1.5.0`, isDesktopOnly `false`
- 405 TS/Svelte files, ~54,995 LOC, bundle `main.js` 575,339 bytes
- 150 test files / 873 tests (post-W1)
- Build gate: `tsc -noEmit -skipLibCheck` (baseline 0 errors)

## meta.strictness (current tsconfig, post-W1)
- ON: `strict`, `noFallthroughCasesInSwitch`, `noImplicitOverride`
- PENDING: `exactOptionalPropertyTypes` (W2, 121), `noUncheckedIndexedAccess` (W3, 374)

## AXIS-A · frontend_surface (inventory)
- **Plugin** ×1 (`src/main.ts` — entry, 81 KB)
- **ItemView** ×11 incl. v2 (`AIInboxView`, `AuditLogView`, `CalendarView`, `CopilotChatView`,
  `MapView`/`MapViewReal`, `SkillRunLogView`, `SyncStatusView`/`SyncStatusViewReal`, + `Views.ts` legacy set)
- **Modal** ×22 (19 `Modal`/`SuggestModal`/`FuzzySuggestModal` subclasses)
- **PluginSettingTab** ×1
- **commands** ×81 (`addCommand`)
- **registerView** ×27

## AXIS-B · backend_logic (inventory)
- **services** ×27 classes (`src/services/`)
- **skills** ×16 `*Skill` (BaseSkill subclasses, `src/skills/`)
- bridge backends: `LanceMemoryBackend` (desktop), `BridgeMemoryBackend`/`LexicalMemoryBackend`/`HybridMemoryBackend` (mobile)
- parsers: `CdelParser`, `DqlLexer`; semiring: `MatrixClosure`; copilot providers & catalog

## AXIS-C · type_system (state)
- discriminant-shaped fields: 1525 (unions exist) · exhaustiveness sentinels (`never`): **0** (R-005 gap)
- branded types: **0**, `src/types/` ABSENT (R-006 gap; DEC-004 reserves `src/types/brands.ts`)
- `as any` ×73 · `as X` ×231 · `: any` ×115 · `as unknown as` ×85 · `<any>` ×14 · `@ts-ignore` **0** (good)

## AXIS-D · event_channels (state, P0 per AX-003)
- raw `addEventListener` ×29 vs `registerDomEvent` ×6 — **leak candidates**
- raw `setInterval` ×5 vs `registerInterval` ×2 — **leak candidates**
- `registerEvent` ×6
- `moment` import hygiene: clean (R-010 ✓)

## AXIS-E · persistence
- `loadData`/`saveData` single-Settings round-trip (R-014 — needs schema-version audit, P-003)
- vault files, metadata cache, frontmatter; KeyVault (encrypted) for OAuth/API keys (GR-005 relevant)

## AXIS-F · lifecycle
- deferred-view footgun (AX-004): 6 `getLeavesOfType`/`iterateAllLeaves` sites, 122 `instanceof` guards present — **per-site audit owed (P-003)**

---

## DEFECT CELLS

| id | cell (axis×axis) | severity | state | file(s) |
|---|---|---|---|---|
| DEF-W0-001 | B×C transport types | P1 | **repaired** | `bridge/{contract,wiring}.ts`, `BridgeMemoryBackend.ts`, `ReachabilityProbe.ts` — dup `HttpRequestFn`/`HttpResponse` merged to canonical (AX-002) |
| DEF-W1-001 | A×F override modifiers | P2 | **repaired** | 54 files, 131 `override` added (noImplicitOverride) |
| DEF-W2 | B×C / E×C optional-vs-undefined | P1 | **open** | 69 files, 121 errors; cluster on `MemoryHit`/`MemoryQuery`/`SemanticResult`/`Entry`/`VectorHit`/`RequestUrlParam` |
| DEF-W3 | B×C / A×C unchecked index access | P1 | **open** | 374 errors (`noUncheckedIndexedAccess`); top: `CdelParser`, `GraphAtlasService`, `MatrixClosure`, `Views` |
| DEF-R004 | C any/cast elimination | P1 | **open** | 73 `as any` + 231 casts + 115 `: any` |
| DEF-R005 | C exhaustiveness | P2 | **open** | 0 `never` sentinels across 1525 discriminant fields |
| DEF-R006 | C branded IDs | P2 | **open** | 0 brands; `src/types/` absent |
| DEF-AX003 | D×F lifecycle leaks | **P0** | **open** | 29 raw `addEventListener`, 5 raw `setInterval` not wrapped in `register*` |
| DEF-AX004 | A×F deferred-view guards | **P0** | **open** | 6 leaf-iteration sites need `instanceof` audit |

## RUNTIME GATES (P-005)
- dev vaults present ×3 → G-004/G-005/G-006 feasible (require launching Obsidian; not CLI-automatable without Playwright/manual)

## DEFECT CELLS — final state (all repaired)
All defect cells listed above are **repaired** as of commit 12a4008:
DEF-W0-001 ✅ · DEF-W1-001 ✅ · DEF-W2 ✅ (121, omit-at-construction) ·
DEF-W3 ✅ (379, guards/locals) · DEF-R004 ✅ (as-any 73→1) · DEF-R005 ✅ (6 sentinels) ·
DEF-R006 ✅ (brands + 21 ViewTypeId) · DEF-AX003 ✅ (timers lifecycle-bound) ·
DEF-AX004 ✅ (instanceof-guarded). **grep state=broken/unknown → 0 (G-007 met).**

## PROGRESS
- ✅ P-001 DISCOVERY — complete
- ✅ P-002 TYPE_CRYSTALLIZATION — all R-003 flags + R-004 + R-005 + R-006 complete
- ✅ P-003 (P0 subset) — AX-003 lifecycle + AX-004 deferred-view complete; exhaustive view/modal round-trip = manual
- ✅ P-004 REPAIR — queue drained (24 agent dispatches, 1 blocked-with-rationale: Modal≠Component)
- ✅ P-005 VERIFICATION — G-001/2/3/7 ✅; G-004 ✅ (loaded: 82 cmds/18 views; 12/12 render-only views open clean via `obsidian eval`); G-005 ✅ (10× reload: cmd count stable 82, DOM delta 0); G-006 not measured (onload unchanged). Commands/network-views/settings = residual manual sweep (side-effect risk)

---

## 0.4.x INTEGRATION (run-20260605-lattice-04x-integration)

> Sub-run extending `run-20260526-obsidian-lattice-01` (baseline 12a4008, v0.3.0).
> Crystallizes the 0.4.x surface (daemon + installer + bridge transport crypto +
> service hardening). All content above is intact; this section is append-only.
> Every number below was re-verified by running the gate commands on commit 9cb93a3.

### meta.plugin (0.4.2, re-verified 2026-06-05)
- id `sauce-crm`, version **`0.4.2`** (was `0.3.0`), minAppVersion `1.5.0`,
  isDesktopOnly **`true`** (was `false` — 0.4.x added Node-builtin/daemon/OS-keychain
  desktop-only surface; mobile path now via the daemon bridge, not in-process)
- **403** non-test TS/Svelte source files under `src/` + **6** daemon non-test src files
- `main.js` bundle **629,975 bytes** = **+9.50%** vs the 575,339 B v0.3.0 anchor
  (G-002 limit +25%; anchor stays the v0.3.0 baseline per task contract)
- tests: **1107** passing across **186** test files (vitest authoritative; canonical
  trees `test/ src/ sdk/ daemon/src/`)
- Build gate: full R-003 strict tsc — **0 errors** (plugin AND daemon)

### meta.strictness (unchanged from after-state)
- ON: all 12 R-003 flags (tsconfig terminal state preserved).
- R-004 after-state: exactly **1** real `as any` (`src/services/EntityService.ts:121`
  frontmatter write) + the **52**-entry `ObsidianApiSchema.ts` string-data colon-any
  set. 0.4.x added **no** new sanctioned casts. Daemon: **0** `any` in non-test src
  (the only `as unknown as` hits are mock seams in daemon `*.test.ts`).

### AXIS-A · frontend_surface (0.4.x deltas)
- **new ItemView ×4** (all `asViewTypeId`-branded, R-006): `CalendarView`
  (`VIEW_CALENDAR = sauce-crm-calendar`, registered main.ts:1263), `MeetingsView`/
  `LanesView`/`WeeklyView` (`VIEW_MEETINGS`/`VIEW_LANES`/`VIEW_WEEKLY`, registered
  main.ts:1720-1722). `registerView` 27→ added these 4.
- **rename** copilot/* → saucebot/* (`CopilotChatView` → `SauceBotChatView`); stable
  view-type ids preserved per commit 04d8442 — no defect cell.
- **new Modal ×1**: `MasterPasswordModal` (`src/ui/modals/v2/MasterPasswordModal.ts`,
  extends `Modal`; KeyVault master-password unlock). Raw `addEventListener` on it is
  the ALLOWED AX-003 exception (Modal ≠ Component; `contentEl.empty()` cleans).
- **commands 81→82** (live-verified); two new ids are plain strings (R-006: NOT
  branded): `reconnect-daemon` (main.ts:1781) + `show-boot-timing` (main.ts:2308).

### AXIS-B · backend_logic (0.4.x deltas)
- **new services**: `DaemonClient` (probeDaemon + createDaemonBackend; single-writer
  detection; reuses `BridgeMemoryBackend` + HMAC signer), `BootTimer` (boot-phase
  instrumentation), `VaultBootstrapper`, `platformPaths` (out-of-vault Lance store
  path + v1 migration), `ModelLifecycle` + `SafeStorageCredentialSource` (saucebot).
- **new modules**: bridge transport-encryption `src/bridge/crypto.ts` (HKDF-SHA256
  key derivation + AES-256-GCM `transportEncrypt`/`transportDecrypt`; contract
  `EncEnvelope`/`TransportCipher`/`ENC_HEADER`/`TRANSPORT_ENC_VERSION`);
  `TokenBucketRateLimiter` (`src/bridge/server/RateLimiter.ts`, per-remote-addr
  token bucket, bounded LRU, injected clock); `WhisperArgs`
  (`src/services/transcribe/WhisperArgs.ts`, pure argv allowlist builder shared by
  plugin WhisperEngine AND daemon transcribe — no duplication).
- **service hardening**: `MirrorSync.fullResyncDetailed` (+239 lines); WhisperEngine
  reviewer-hardening (consent gate + audit sink + child-process kill-on-unload
  registry); SmtpImap wiring (`IntegrationRegistry.ts` + `smtpimap/index.ts`);
  KeyVault change/reset/HKDF (+193 lines).

### AXIS-G · daemon (NEW out-of-process runtime — standalone Node)
- `daemon/**` = `sauce-crm-daemon`: standalone Node process, own `tsconfig.json` +
  esbuild bundle (`daemon/dist/sauce-crm-daemon.cjs`). Src: `index.ts` (entry),
  `server.ts` (HTTP + `RoutingMemoryBackend`, `VAULT_HEADER`), `transcribe.ts`
  (imports plugin `buildWhisperArgs` + `execFileNoThrow` — verified, no dup),
  `config.ts`, `vaults.ts`, `version.ts`. Packaging: Linux systemd / macOS launchd /
  Windows / Windows-WSL2 install+uninstall under `daemon/packaging/**`.
- **EXEMPT** from Obsidian-specific axioms (AX-003/AX-004/R-006 brands) per task
  contract; **must stay any-free + tsc-clean** — BOTH re-verified: daemon tsc 0
  errors, 0 `any` in non-test src.

### AXIS-H · installer (NEW, non-TS)
- `installer/**` (`install.sh` + `install.ps1`): one-line cross-OS installer
  (detect/consent-install Obsidian, pick vault, install plugin, pre-enable); bundled
  into the pinnable 0.4.2 release. Not TS — exempt from type axioms. Does NOT bypass
  Obsidian Restricted Mode (DEC-014).

### 0.4.x DEFECT CELLS (audit deltas — all repaired/connected)

| id | cell (axis×axis) | severity | state | repaired-state evidence |
|---|---|---|---|---|
| DEF-04x-G · daemon out-of-process | G×B single-writer | — | **connected** | `DaemonClient.probeDaemon` detects a live daemon and routes via daemon backend; plugin LanceMemoryBackend yields write ownership → no two-writer corruption (DEC-008). daemon tsc 0, 0 any. |
| DEF-04x-CRYPTO · transport encryption | B×C confidentiality | — | **connected** | `bridge/crypto.ts` AES-256-GCM + HKDF key separation; tamper/replay covered by tests (DEC-009). |
| DEF-04x-RL · rate limiting | B×F DoS surface | — | **connected** | `RateLimiter.ts` token bucket + bounded LRU + injected clock; per-remote-addr. |
| DEF-04x-WHISPER · spawn policy | B×F exec safety | — | **connected** | argv allowlist (`WhisperArgs`) + `execFileNoThrow` (no shell); plugin detect-only, daemon auto-provision (DEC-010). |
| DEF-04x-NODEBUILTIN · bundler builtins | G×E build | — | **connected** | lazy bare-require convention + `test/build-conventions.test.ts` guard (DEC-012); G-002 build PASS. |
| DEF-04x-VIEWS · new branded views | A×F lifecycle | — | **connected** | `VIEW_CALENDAR/MEETINGS/LANES/WEEKLY` asViewTypeId-branded (R-006), registerView-bound. |
| DEF-04x-MPM · MasterPasswordModal | A×D event cleanup | — | **connected** | Modal raw addEventListener = ALLOWED AX-003 exception (contentEl.empty cleans). |
| DEF-04x-KEYVAULT · change/reset/HKDF | E×C key mgmt | — | **connected** | KeyVault +193 lines; change/reset re-derive via HKDF; covered by KeyVault tests. |

**grep state=broken/unknown → 0 (G-007 met).** No new defect cells; all 0.4.x
additions land connected.
