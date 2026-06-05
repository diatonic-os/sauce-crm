# TEST_MATRIX — sauce-crm crystallization (D-004)

Run `run-20260526-obsidian-lattice-01` · branch `crystallize/type-lattice` · commit 12a4008

## Static gates (automated, authoritative)

| Gate | Check | Result |
|---|---|---|
| **G-001** | `tsc --noEmit` with full R-003 strict set (all 12 flags) | ✅ **0 errors** |
| **G-002** | production build (`tsc && esbuild production`) | ✅ **PASS** — `main.js` 581,440 B (+1.05% vs 575,339 baseline; SS-003 limit +25%) |
| **G-003** | unit + integration tests (`vitest run`) | ✅ **873/873** (150 files) |
| **G-007** | LATTICE_MAP zero broken/unknown cells | ✅ all defect cells repaired (see LATTICE_MAP) |

Re-verified after every wave (R-019). One regression (vitest blind to `@/` tsconfig
alias) caught by the integration gate and fixed at root (`vitest.config.ts`).

## Per-concern results

| Concern | Before | After | Method |
|---|---|---|---|
| R-003 strict flags | 0/12 on, 629 latent errors | 12/12 on, 0 errors | 4 flip-fix-verify waves (W0–W3) |
| R-004 `as any` | 73 | 1 (Obsidian `any`-boundary write) | obsidian-augment.ts + narrow shapes/guards |
| R-004 `: any` | 115 | 54 (all API-signature **string data** in ObsidianApiSchema.ts) | concrete types / `unknown`+guard |
| R-005 sentinels | 0 | 6 (closed-union switches) | per-switch Socratic; open-string switches skipped |
| R-006 brands | 0, no `src/types/` | 6 brands + ctor/guard; 21 ViewTypeId consts | brands.ts foundation + adoption |
| AX-003 timers | 5 raw setInterval | 2 (both `clearInterval` in `stop()`, registered to unload); 3→registerInterval | lifecycle binding |
| AX-003 DOM events | 29 raw addEventListener | raw only on Modal/SettingTab (non-Component; contentEl.empty cleans) | registerDomEvent where Component |
| AX-004 deferred views | unaudited | main.ts leaf.view instanceof-guarded | guard before view access |

## Runtime gates (G-004/5/6) — RUN via `obsidian eval` against the live instance

`obsidian eval code='<js>'` works on this host (talks to the running Obsidian over a
socket). The crystallized build was sha256-verified deployed and `hot-reload`-loaded
into the live `Sauce_Relationship_Graph` vault, then probed directly:

| Gate | Probe | Result |
|---|---|---|
| **G-004** load | `app.plugins.plugins['sauce-crm']`; enumerate commands + view types | ✅ **PASS** — loaded v0.3.0, **82 commands**, **18 view types**; ViewTypeId-branded values registered correctly as strings |
| **G-004** view render | open all 12 render-only views (`setViewState`), confirm `onOpen` runs without throw, detach | ✅ **PASS** — 12/12 instantiated + rendered + detached, **0 errors**, 0 leftover leaves |
| **G-005** leak | 10× `disablePlugin`→`enablePlugin`; track command count + DOM node count | ✅ **PASS** — command count **always exactly 82** (no accumulation), view types stable 18, **DOM nodes delta 0** (1083→1083), no exception |
| **G-005** static | timers/events lifecycle-bound | ✅ all `setInterval` `clearInterval` in `stop()` wired to `this.register()`; DOM events via `registerDomEvent` or auto-emptied containers |
| `obsidian.log` | main-process error scan | ✅ zero errors/exceptions with crystallized code live |

**Not auto-exercised (side-effect risk):** the 82 commands, the network-heavy views
(Copilot Chat, Map, Sync Status, AI Inbox), and settings mutations were NOT fired
programmatically — running them can mutate the vault / make network calls. These
remain a manual QA sweep. **G-006** (startup-time delta) was not measured (needs the
Obsidian debug-startup tool); onload structure is unchanged by this refactor.

### Residual manual checklist (operator)
1. Command palette → run a sampling of Sauce CRM commands; open the network-heavy views (Copilot, Map, Sync Status, AI Inbox); watch the console.
2. Settings → toggle through each Sauce CRM page; change a value; confirm persistence on reload.

---

## 0.4.x re-verification (run-20260605-lattice-04x-integration)

Sub-run on commit `9cb93a3` (baseline 12a4008 → v0.4.3). Every figure below was
produced by running the gate command, not copied from the audit packet.

### Static gates (re-run, authoritative)

| Gate | Check | Result |
|---|---|---|
| **G-001** | `npx tsc --noEmit` full R-003 strict (all 12 flags), plugin | ✅ **0 errors** |
| **G-001** (daemon) | `npx tsc --noEmit` in `daemon/` (any-free + tsc-clean) | ✅ **0 errors**, **0 `any`** in non-test src |
| **G-002** | `npm run build` (tsc + esbuild production) | ✅ **PASS** — `main.js` **629,975 B** = **+9.50%** vs 575,339 B v0.3.0 anchor (SS-003 limit +25%) |
| **G-003** | `npx vitest run` | ✅ **1107/1107** across **186** test files |
| **G-007** | LATTICE_MAP zero broken/unknown cells | ✅ all 0.4.x cells connected; grep state=broken/unknown → 0 |

R-004 census re-checked: exactly **1** real `as any` (`EntityService.ts:121`,
frontmatter write) + the ObsidianApiSchema string-data colon-any set (**52** entries).
The 3 other `as any` string hits in src are COMMENTS (not violations). Daemon `any`
grep hits (×2) are `as unknown as OpenVault["lance"]` mock seams in `daemon/src/*.test.ts`.

### Per-new-module coverage

| Module | Coverage surface | Result |
|---|---|---|
| daemon `config.ts` / `server.ts` / `vaults.ts` | `daemon/src/*.test.ts` (server, whisper-route, config/vaults resolution; VAULT_HEADER routing) | ✅ pass |
| `DaemonClient` | probeDaemon + createDaemonBackend single-writer detection | ✅ pass |
| transport crypto (`bridge/crypto.ts`) | tamper (GCM auth-tag) + replay rejection, HKDF key separation, transportEncrypt/Decrypt round-trip | ✅ pass |
| `WhisperArgs` | pure argv allowlist builder (shared plugin+daemon; rejects non-allowlisted flags) | ✅ pass |
| `RateLimiter` (`TokenBucketRateLimiter`) | per-remote-addr bucket, bounded LRU eviction, injected-clock refill | ✅ pass |
| `MirrorSync.fullResyncDetailed` | full-resync detail reconciliation (+239 lines) | ✅ pass |
| `KeyVault` change/reset/HKDF | master-password change, reset, HKDF re-derivation (+193 lines) | ✅ pass |
| build-conventions guard (`test/build-conventions.test.ts`) | asserts node builtins use lazy bare-require, not static value import (0.4.0 node:tls regression guard) | ✅ pass |

**Not auto-exercised (unchanged from v0.3.0):** the 82 commands, network-heavy views,
and settings mutations remain a manual QA sweep. The daemon's live systemd/launchd
install + plugin↔daemon socket handshake is an operator integration step (packaging
scripts present under `daemon/packaging/**`, not CI-exercised here).
