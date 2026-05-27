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
