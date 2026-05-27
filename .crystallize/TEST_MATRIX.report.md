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

## Runtime gates (G-004/5/6) — host-blocked, partial evidence

The host blocks full automation: `obsidian eval` (CLI) is disabled, and the running
Obsidian instance was not started with a CDP debug port. Per contract assumption
A-004, these are **skipped-with-warning**, with the following partial evidence:

| Gate | Intended | Evidence available | Verdict |
|---|---|---|---|
| **G-004** load test | enable plugin, run every command/view/modal/setting, capture console | Build deployed (sha256-verified) to 3 dev vaults; `hot-reload` enabled → crystallized code live in running instance; **`obsidian.log` shows zero errors/exceptions** | ⚠️ indirect PASS (no logged errors); exhaustive command/view sweep needs manual pass |
| **G-005** leak probe | 50× enable/disable, heap-snapshot EventRef/listener/interval diff | **Static guarantee**: all intervals `clearInterval` in `stop()` wired to `this.register()`; DOM events via `registerDomEvent` or on auto-emptied containers | ⚠️ static PASS; empirical heap diff needs manual DevTools pass |
| **G-006** startup time | plugin contribution ≤ +10% baseline | onload structure unchanged by this refactor (no new top-level work) | ⚠️ not measured (needs Obsidian debug-startup tool) |

### Manual runtime-gate checklist (operator, in the already-open Obsidian)
1. `Ctrl+Shift+I` → Console. Reload (`Ctrl+R`) the vault. Confirm **no red errors** mentioning `sauce-crm` / `plugin:sauce-crm`.
2. Command palette → run a sampling of Sauce CRM commands; open each custom view (Map, AI Inbox, Copilot Chat, Sync Status, Audit Log, Skill Run Log, dashboards); open a few modals (Person, Org, Touch, Quick Capture). Watch console.
3. Settings → toggle through each Sauce CRM settings page; change a value; confirm it persists on reload.
4. Leak: Settings → Community plugins → toggle sauce-crm off/on ~10×; in DevTools Performance/Memory, confirm listener/interval counts don't grow.
