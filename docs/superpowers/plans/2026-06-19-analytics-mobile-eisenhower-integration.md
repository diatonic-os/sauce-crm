# Analytics Deepening + Mobile + Eisenhower + Tasks/Calendar Integration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every analytics view fully mobile-usable; add a real statistical layer (descriptive stats, z-scores, new cross-matrix correlations, org rollups); build a built-in Eisenhower urgency×importance prioritization engine for tasks; and tighten task↔calendar and obsidian-tasks-plugin integration.

**Architecture:** Four independent phases, each independently shippable and gated. Pure calculation logic stays in framework-free, unit-tested service modules (extending the `RelationshipAnalytics.ts` pure-layer pattern). UI/views consume those services; CSS mobile fixes are additive media queries + a `Platform.isMobile` layout-swap helper. No change to the locked task/touch/event frontmatter schemas — new signals are *computed*, not stored.

**Tech Stack:** TypeScript (strict, `noUncheckedIndexedAccess`), Svelte 5 runes, Obsidian ItemView API, esbuild, vitest (jsdom, `test/_stubs/obsidian.ts`), scoped + global `styles.css`.

## Global Constraints

- Branch: `feat/analytics-mobile-eisenhower` (worktree off `main` @ `0ce3fe3`). Never edit the in-flight Wave-2 files in the main checkout.
- Strict TS: every indexed access may be `undefined` (`noUncheckedIndexedAccess`); guard with `?? null`/`?? default`.
- Never name an `ItemView` method `open` (shadows Obsidian `View.open` → blank render). Use `openPath` resolving to `TFile` + `getLeaf(false).openFile(f)`.
- Data collection is by frontmatter `type`, never by folder.
- Dates may be JS `Date` (unquoted YAML) OR strings — always normalize via `coerceIsoDay`/`parseIsoSafe` before comparison or use as map keys.
- Task/touch/event/followup frontmatter schemas are LOCKED (`src/domain/schemas/index.ts`). Add computed signals; do not add stored fields without a DEC.
- Per-task gate before commit: `npx tsc -noEmit` PASS, `npm run lint` PASS, `npx vitest run <files>` PASS. Phase-end gate: full `npm run build` + live `obsidian eval`/`dev:screenshot` validation.
- Mobile target: usable at 360px width (iPhone SE/mini portrait); tap targets ≥44px (Apple HIG); no horizontal page scroll except inside explicitly-scrollable wrappers.

---

## Phase 1 — Mobile Responsiveness for Analytics Views

The base mobile infra (`src/ui/MobileStyles.ts`, breakpoints at 640/480/360px in `styles.css`) is solid, but the analytics views have fixed widths that break on phones. Strategy: (a) additive media queries in `styles.css`; (b) a small `Platform.isMobile` layout-swap for the two views that cannot merely reflow (matrix, graph).

### Task 1.1: Mobile media queries for matrix / heatmap / kanban / dashboard / modal

**Files:**
- Modify: `styles.css` (append a `@media (max-width: 600px)` block near the existing mobile rules ~line 1413–1431)

**Interfaces:**
- Produces: CSS only. Targets existing classes: `.sauce-matrix-wrap`, `.sauce-matrix`, `.sauce-heatmap-months`, `.sauce-heatmap-wrap`, `.sauce-kanban`, `.sauce-view-kpis`, `.sauce-dashboard-columns`, `--sg-modal-w`.

- [ ] **Step 1: Add the mobile analytics block to `styles.css`**

```css
/* ===== Mobile analytics overrides (≤600px) ===== */
@media (max-width: 600px) {
  /* Matrix + heatmap: keep their natural width but make the wrapper the
     scroll boundary so the PAGE never scrolls; add an inertia scroll. */
  .sauce-matrix-wrap, .sauce-heatmap-wrap {
    overflow-x: auto;
    -webkit-overflow-scrolling: touch;
    scrollbar-width: thin;
  }
  .sauce-heatmap-months { min-width: 0; }          /* was 610px — let it ride the scroll wrapper */
  /* Kanban: stack lanes vertically instead of a horizontal rail. */
  .sauce-kanban { grid-template-columns: 1fr !important; }
  /* Dashboard: force single-column KPIs + columns below the auto-fit floor. */
  .sauce-view-kpis { grid-template-columns: repeat(2, 1fr) !important; }
  .sauce-dashboard-columns { grid-template-columns: 1fr !important; }
  /* Modal: tighter than 38rem on a phone. */
  :root { --sg-modal-w: min(94vw, 38rem); }
}
@media (max-width: 380px) {
  .sauce-view-kpis { grid-template-columns: 1fr !important; }
}
```

- [ ] **Step 2: Visual-verify on a narrow window**

Run (with Obsidian open on the dev vault):
```bash
obsidian eval code="(async()=>{await app.workspace.getLeaf(true).setViewState({type:'sauce-compat',active:true});return 'ok'})()"
obsidian dev:screenshot path=/tmp/m-compat.png
```
Expected: matrix scrolls inside its wrapper; no page-level horizontal scroll. Read the screenshot to confirm.

- [ ] **Step 3: Commit**
```bash
git add styles.css && git commit -m "fix(mobile): responsive overrides for matrix/heatmap/kanban/dashboard/modal"
```

### Task 1.2: `Platform.isMobile` layout swap for matrix (card list) and graph (disabled notice)

**Files:**
- Modify: `src/ui/views/Views.ts` — `CompatibilityMatrixView.onOpen` (~line 808) and `TypedEdgeGraphView.onOpen` (~line 583)
- Test: `test/ui/Views.mobile.test.ts` (new)

**Interfaces:**
- Consumes: `Platform.isMobile` from `obsidian`.
- Produces: on mobile, `CompatibilityMatrixView` renders a **ranked pair list** (top compatible pairs as rows) instead of the NxN grid; `TypedEdgeGraphView` renders a top-degree node list + "open on desktop for the interactive graph" notice.

- [ ] **Step 1: Write the failing test** (`test/ui/Views.mobile.test.ts`)
```ts
import { describe, it, expect, vi } from "vitest";
// Force mobile before importing the view module.
vi.mock("obsidian", async (orig) => {
  const real = await orig<typeof import("obsidian")>();
  return { ...real, Platform: { ...real.Platform, isMobile: true } };
});
import { CompatibilityMatrixView } from "@/ui/views/Views";

it("CompatibilityMatrixView renders a pair LIST (not a grid) on mobile", async () => {
  // minimal plugin stub with two people carrying overlapping roles
  const view = new (CompatibilityMatrixView as any)({} as never, makeStubPlugin());
  await view.onOpen();
  expect(view.contentEl.querySelector(".sauce-matrix")).toBeNull();
  expect(view.contentEl.querySelector(".sauce-compat-pairlist")).not.toBeNull();
});
// makeStubPlugin(): returns { app, entityService: { allPeople:()=>[...] } } — see existing Views tests for the shape.
```
- [ ] **Step 2: Run it — expect FAIL** (`.sauce-compat-pairlist` not produced). `npx vitest run test/ui/Views.mobile.test.ts`
- [ ] **Step 3: Implement** — in `CompatibilityMatrixView.onOpen`, after collecting people, branch:
```ts
import { Platform } from "obsidian";
// ... inside onOpen, after `const people = ...`:
if (Platform.isMobile) { this.renderPairList(root, people); return; }
// renderPairList: compute all pairs' density via computeCompatibleSet (reuse existing
// import), sort desc, render top 30 as .sauce-compat-pairlist rows:
//   [A] ⇄ [B]   density%   shared: roles, industry   → click opens A.
```
And in `TypedEdgeGraphView.onOpen`: `if (Platform.isMobile) { this.renderTopNodes(root); return; }` — list top-20 nodes by `degree` (from `GraphAtlasService`) with a one-line "interactive graph available on desktop" `.sauce-empty-state`.
- [ ] **Step 4: Run test — expect PASS**
- [ ] **Step 5: Add CSS** for `.sauce-compat-pairlist` (flex column rows, reuse `.sauce-attention-row` styling) to `styles.css`; **commit** both files.

### Task 1.3: Calendar + table mobile rules

**Files:**
- Modify: `src/ui/svelte/Calendar.svelte` (scoped `<style>`, add `@media (max-width:600px)`)
- Modify: `styles.css` (table column-collapse for `.sauce-index-table`, `.sauce-sync-jobs`)

- [ ] **Step 1:** In `Calendar.svelte` scoped style, add: month/week cells `min-height: 38px; font-size: 0.8em;`; hide the year-view at ≤480px in favor of month; `.sauce-cal-modes` wrap. **Step 2:** In `styles.css`, at ≤600px give `.sauce-table-wrap{overflow-x:auto}` and shrink index-table cell padding. **Step 3:** screenshot calendar at narrow width, confirm. **Step 4:** Commit.

**Phase 1 gate:** `tsc`+`lint`+`vitest` green; `npm run build`; screenshot-audit compat/heatmap/kanban/dashboard/calendar at ~390px → all usable, no page-level horizontal scroll.

---

## Phase 2 — Statistical Core + New Cross-Matrix Correlations

Today only one Pearson (cadence×closeness) exists; there are no descriptive stats. Add a pure `Statistics.ts` primitives module, then a `CrossMatrixAnalytics.ts` that produces a correlation matrix + org rollups + z-score outliers, surfaced into `DashboardView`.

### Task 2.1: `Statistics.ts` — pure descriptive-stat primitives (TDD)

**Files:**
- Create: `src/services/stats/Statistics.ts`
- Test: `test/services/stats/Statistics.test.ts`

**Interfaces:**
- Produces: `mean(xs:number[]):number|null`, `median(xs):number|null`, `stddev(xs, sample=true):number|null`, `quantile(xs, q:number):number|null`, `zscores(xs):number[]`, `pearson(xs,ys):number|null` (move/re-export the existing impl), `spearman(xs,ys):number|null`, `summary(xs):{n,mean,median,sd,min,max,p25,p75}|null`.

- [ ] **Step 1: Write failing tests** — exact expected values:
```ts
import { mean, median, stddev, quantile, zscores, spearman, summary } from "@/services/stats/Statistics";
it("mean/median/stddev", () => {
  expect(mean([2,4,6])).toBe(4);
  expect(median([1,2,3,4])).toBe(2.5);
  expect(stddev([2,4,4,4,5,5,7,9])).toBeCloseTo(2.138, 3); // sample sd
});
it("quantile linear-interp", () => { expect(quantile([1,2,3,4],0.5)).toBe(2.5); expect(quantile([1,2,3,4],0.25)).toBe(1.75); });
it("zscores center to 0 mean", () => { const z=zscores([1,2,3]); expect(mean(z)).toBeCloseTo(0,10); });
it("spearman of monotonic = 1", () => { expect(spearman([1,2,3,4],[10,20,30,40])).toBeCloseTo(1,10); });
it("empty → null", () => { expect(mean([])).toBeNull(); expect(summary([])).toBeNull(); });
```
- [ ] **Step 2: Run — expect FAIL** (module missing). `npx vitest run test/services/stats/Statistics.test.ts`
- [ ] **Step 3: Implement** — pure functions:
```ts
export function mean(xs: number[]): number | null { return xs.length ? xs.reduce((a,b)=>a+b,0)/xs.length : null; }
export function median(xs: number[]): number | null { return quantile(xs, 0.5); }
export function stddev(xs: number[], sample = true): number | null {
  const m = mean(xs); if (m == null) return null;
  const denom = sample ? xs.length - 1 : xs.length; if (denom <= 0) return null;
  return Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / denom);
}
export function quantile(xs: number[], q: number): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const pos = (s.length - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos);
  const a = s[lo] ?? null; if (a == null) return null;
  const b = s[hi] ?? a; return a + (b - a) * (pos - lo);
}
export function zscores(xs: number[]): number[] {
  const m = mean(xs), sd = stddev(xs, false);
  if (m == null || !sd) return xs.map(() => 0);
  return xs.map((x) => (x - m) / sd);
}
// pearson: move the existing impl from RelationshipAnalytics here and re-export it there.
// spearman: rank xs and ys (average ranks for ties), then pearson(rank(xs), rank(ys)).
export function summary(xs: number[]) {
  if (!xs.length) return null;
  return { n: xs.length, mean: mean(xs)!, median: median(xs)!, sd: stddev(xs) ?? 0,
    min: Math.min(...xs), max: Math.max(...xs), p25: quantile(xs,0.25)!, p75: quantile(xs,0.75)! };
}
```
- [ ] **Step 4: Run — expect PASS.** **Step 5: Commit.**

### Task 2.2: Re-point `RelationshipAnalytics.pearson` to `Statistics`

**Files:** Modify `src/services/RelationshipAnalytics.ts` (delete local `pearson`, import from `./stats/Statistics`). Test: existing `RelationshipAnalytics.test.ts` must stay green.
- [ ] Replace the local `pearson` (lines ~130–154) with `import { pearson } from "./stats/Statistics";`. Run `npx vitest run test/services/RelationshipAnalytics.test.ts` → expect PASS (20 tests). Commit.

### Task 2.3: `CrossMatrixAnalytics.ts` — correlation matrix + org rollups + outliers (TDD)

**Files:**
- Create: `src/services/stats/CrossMatrixAnalytics.ts`
- Test: `test/services/stats/CrossMatrixAnalytics.test.ts`

**Interfaces:**
- Consumes: `PersonStat[]` (extend it in `RelationshipAnalytics` to also carry `channelCounts: Record<string,number>`, `outcomeCounts: Record<string,number>`, `degree: number` from `GraphAtlasService`), `DealStat[]`, `Statistics`.
- Produces:
```ts
export interface VariablePair { a: string; b: string; r: number; n: number; strength: string; }
export interface OrgRollup { org: string; people: number; avgCloseness: number; totalTouches: number; openDeals: number; healthScore: number; }
export interface Outlier { path: string; name: string; metric: string; z: number; note: string; }
export interface CrossMatrixReport { variables: string[]; matrix: (number|null)[][]; topPairs: VariablePair[]; orgRollups: OrgRollup[]; outliers: Outlier[]; }
export function buildCrossMatrix(people: PersonStat[], orgsByPerson: Map<string,string>, deals: DealStat[]): CrossMatrixReport;
```
- [ ] **Step 1: Failing tests** — variables = `["closeness","touchCount","degree","daysSinceTouch","callShare"]`; assert `matrix` is square `5×5` with diagonal `1`, symmetric (`matrix[i][j]===matrix[j][i]`); `topPairs` sorted by `|r|` desc; an org rollup `healthScore` in `[0,1]`; a planted closeness-outlier (closeness 5, 200d gap) appears in `outliers` with `z` beyond ±2.
- [ ] **Step 2: Run — expect FAIL.**
- [ ] **Step 3: Implement** — for each variable extract the per-person numeric vector (aligned indices), compute `pearson` for every pair → `matrix`; flatten upper triangle, sort by `|r|`, label via `interpretCorrelation` → `topPairs`. Org rollups: group people by `orgsByPerson`, aggregate; `healthScore = clamp01(0.4*norm(avgCloseness/5) + 0.3*norm(touchRecency) + 0.3*norm(openDeals))`. Outliers: `zscores` per metric; flag `|z| ≥ 2`.
- [ ] **Step 4: Run — expect PASS.** **Step 5: Commit.**

### Task 2.4: Extend `PersonStat` collection with channel/outcome/degree

**Files:** Modify `src/services/RelationshipAnalytics.ts` `peopleStats()` (~lines 383–411) to also tally `channelCounts` (by `touch.channel`), `outcomeCounts` (by `touch.outcome_tags[]`), and join `degree` from `GraphAtlasService`. Test: extend `RelationshipAnalytics.test.ts`.
- [ ] Add fields to `PersonStat`; populate in `peopleStats`; add a unit test asserting `channelCounts.call` counts call-touches. tsc+vitest+commit.

### Task 2.5: Surface the cross-matrix in `DashboardView`

**Files:** Modify `src/ui/views/Views.ts` `DashboardView` — add a collapsible "Correlation matrix & outliers" section (additive, after "What needs attention"): render the NxN matrix as a small heatmap (reuse `.sauce-matrix-*`), the top-3 pairs as plain sentences, and outliers as `.sauce-attention-row`s. CSS additions delimited; merge centrally.
- [ ] Implement render method; live-verify via `obsidian eval` that the matrix section renders with real numbers; **commit**.

**Phase 2 gate:** new stats tests green; `RelationshipAnalytics` tests still green; dashboard shows a real correlation matrix + outliers live.

---

## Phase 3 — Built-in Eisenhower Matrix Prioritization

Reuse the `rankSuggestions` severity+score pattern. **Urgency** from due-date proximity (and overdue), **Importance** from `priority` enum × linked-contact `closeness` × blocking. Pure engine + a new quadrant view + a `sortBy:"quadrant"` in the Svelte dashboard.

### Task 3.1: `EisenhowerEngine.ts` — pure quadrant scoring (TDD)

**Files:**
- Create: `src/services/tasks/EisenhowerEngine.ts`
- Test: `test/services/tasks/EisenhowerEngine.test.ts`

**Interfaces:**
- Consumes: `TaskInput = { path:string; title:string; status:string; due:string|null; priority:string|null; contact:string|null; blockedBy:number }` and a `closenessOf(contact:string|null):number` resolver (0–5; default 3).
- Produces:
```ts
export type Quadrant = "do" | "schedule" | "delegate" | "eliminate"; // Q1..Q4
export interface Scored { input: TaskInput; urgency: number; importance: number; quadrant: Quadrant; score: number; }
export const URGENT_THRESHOLD = 0.5; export const IMPORTANT_THRESHOLD = 0.5;
export function urgencyOf(t: TaskInput, now: Date): number;     // 0..1
export function importanceOf(t: TaskInput, closeness: number): number; // 0..1
export function quadrantOf(u: number, i: number): Quadrant;
export function scoreTasks(tasks: TaskInput[], closenessOf: (c:string|null)=>number, now: Date): Scored[];
```
- [ ] **Step 1: Failing tests** with exact expectations:
```ts
import { urgencyOf, importanceOf, quadrantOf, scoreTasks } from "@/services/tasks/EisenhowerEngine";
const now = new Date("2026-06-19T00:00:00Z");
it("overdue task is maximally urgent", () => {
  expect(urgencyOf({due:"2026-06-10",status:"todo"} as any, now)).toBe(1);
});
it("urgency decays with horizon", () => {
  const u3 = urgencyOf({due:"2026-06-22",status:"todo"} as any, now); // 3 days out
  const u14 = urgencyOf({due:"2026-07-03",status:"todo"} as any, now);
  expect(u3).toBeGreaterThan(u14);
  expect(urgencyOf({due:null,status:"todo"} as any, now)).toBeLessThan(0.3); // no due = low urgency
});
it("importance blends priority + closeness + blocking", () => {
  const hi = importanceOf({priority:"urgent",contact:"A",blockedBy:0} as any, 5);
  const lo = importanceOf({priority:"low",contact:null,blockedBy:0} as any, 3);
  expect(hi).toBeGreaterThan(lo); expect(hi).toBeLessThanOrEqual(1);
});
it("quadrant mapping", () => {
  expect(quadrantOf(0.9,0.9)).toBe("do");
  expect(quadrantOf(0.1,0.9)).toBe("schedule");
  expect(quadrantOf(0.9,0.1)).toBe("delegate");
  expect(quadrantOf(0.1,0.1)).toBe("eliminate");
});
it("done/cancelled tasks score urgency 0", () => {
  expect(urgencyOf({due:"2026-06-10",status:"done"} as any, now)).toBe(0);
});
```
- [ ] **Step 2: Run — expect FAIL.**
- [ ] **Step 3: Implement** the formulas:
```ts
const DONE = new Set(["done","cancelled"]);
export function urgencyOf(t: TaskInput, now: Date): number {
  if (DONE.has(t.status)) return 0;
  if (!t.due) return 0.2;                                   // undated → mild background urgency
  const days = Math.floor((Date.parse(t.due+"T00:00:00Z") - now.getTime()) / 86_400_000);
  if (days <= 0) return 1;                                  // due today or overdue
  return Math.max(0, Math.min(1, 1 - days / 14));           // linear decay over a 2-week horizon
}
const PRIO: Record<string, number> = { urgent: 1, high: 0.75, medium: 0.5, low: 0.25 };
export function importanceOf(t: TaskInput, closeness: number): number {
  if (DONE.has(t.status)) return 0;
  const p = PRIO[t.priority ?? "medium"] ?? 0.5;            // 0.25..1
  const c = Math.max(0, Math.min(1, closeness / 5));        // 0..1
  const blocker = t.blockedBy > 0 ? 0.15 : 0;              // a task blocking others matters more
  return Math.max(0, Math.min(1, 0.6 * p + 0.25 * c + blocker));
}
export function quadrantOf(u: number, i: number): Quadrant {
  const U = u >= URGENT_THRESHOLD, I = i >= IMPORTANT_THRESHOLD;
  return U && I ? "do" : !U && I ? "schedule" : U && !I ? "delegate" : "eliminate";
}
export function scoreTasks(tasks: TaskInput[], closenessOf: (c:string|null)=>number, now: Date): Scored[] {
  return tasks.filter(t => !DONE.has(t.status)).map((t) => {
    const u = urgencyOf(t, now), i = importanceOf(t, closenessOf(t.contact));
    return { input: t, urgency: u, importance: i, quadrant: quadrantOf(u, i), score: 0.6*u + 0.4*i };
  }).sort((a,b) => b.score - a.score);
}
```
- [ ] **Step 4: Run — expect PASS.** **Step 5: Commit.**

### Task 3.2: `EisenhowerView` — a 2×2 quadrant ItemView (TDD-light + live)

**Files:**
- Create: `src/ui/views/v2/EisenhowerView.ts` (ItemView, type `sauce-eisenhower`)
- Modify: `src/main.ts` — register the view + add to the W4 launcher menu (CRM dashboards group) + a command + a ribbon entry. (NOTE: in the real merge this file also carries Wave-2 edits; keep additions in the existing view-registration/command regions.)
- Test: `test/ui/EisenhowerView.test.ts`

**Interfaces:**
- Consumes: `scoreTasks` from `EisenhowerEngine`; a closeness resolver built from `EntityService.allPeople()`; task collection mirroring `TasksView.collectTaskRows` (factor a shared `collectTaskInputs(plugin): TaskInput[]` into `src/services/tasks/collectTasks.ts` so both views share it).
- Produces: a 2×2 CSS grid — Q1 Do (urgent+important), Q2 Schedule (important), Q3 Delegate (urgent), Q4 Eliminate — each cell a clickable task list; click opens the note via `openPath`.
- [ ] **Step 1:** Extract `collectTaskInputs(plugin): TaskInput[]` (with `blockedBy = (fm.blocked_by?.length ?? 0)`); unit-test it returns inputs with normalized status. **Step 2:** Implement `EisenhowerView.onOpen`: `addClass("sauce-view")`, header, build closeness map, `scoreTasks`, render four `.sauce-eis-quadrant` cells with counts. **Step 3:** Register in `main.ts`. **Step 4:** CSS `.sauce-eis-grid{display:grid;grid-template-columns:1fr 1fr;gap:…}` + mobile single-column. **Step 5:** live `obsidian eval` open `sauce-eisenhower`, confirm quadrants populate (note: needs `type:task` notes — seed 3–4 temporary tasks in the dev vault to validate, then delete). **Step 6:** Commit.

### Task 3.3: Add `sortBy:"quadrant"` + quadrant badges to `TasksDashboard.svelte`

**Files:** Modify `src/ui/svelte/TasksDashboard.svelte` + `src/ui/views/v2/DashboardViews.ts` (pass computed quadrant per row) + `DashboardTypes.ts` (`TaskRow.quadrant?: Quadrant`).
- [ ] Compute quadrant in `collectTaskRows` (reuse `EisenhowerEngine`), add a "quadrant" option to the existing `sortBy` control, render a small quadrant pill. tsc+lint+vitest; live-verify; commit.

**Phase 3 gate:** engine tests green; Eisenhower view renders 4 populated quadrants live; Tasks dashboard sorts by quadrant.

---

## Phase 4 — Tighter Tasks ↔ Calendar ↔ obsidian-tasks-plugin Integration

### Task 4.1: Drag-to-reschedule + click-to-edit due date in the calendar

**Files:**
- Modify: `src/ui/svelte/Calendar.svelte` (add `draggable` to event chips/dots; emit `onReschedule(path, newDate)` on drop into a day cell)
- Modify: `src/ui/svelte/CalendarTypes.ts` (add `onReschedule?: (path:string,newDate:string)=>void` to props)
- Modify: `src/ui/views/v2/CalendarView.ts` — implement `reschedule(path,newDate)`: resolve `TFile`, `entityService.updateFrontmatter` setting `due` (task/followup) or `date` (touch/event) by the note's `type`, then re-`collectEvents` + remount.
- Test: `test/ui/CalendarReschedule.test.ts` — assert `updateFrontmatter` is called with the new date for a task drop.
- [ ] TDD the `reschedule` field-mapping (task/followup→`due`, touch/event→`date`); implement DnD in Svelte; live-verify a drag updates frontmatter; commit.

### Task 4.2: Eisenhower-quadrant color overlay toggle on the calendar

**Files:** Modify `Calendar.svelte` (a "color by: kind | quadrant" toggle) + `CalendarView.collectEvents` to attach `quadrant` to task events via `EisenhowerEngine`. CSS quadrant colors (Q1 red, Q2 blue, Q3 amber, Q4 grey).
- [ ] Add the toggle + quadrant coloring for `kind==="task"` events; live-verify; commit.

### Task 4.3: obsidian-tasks-plugin two-way bridge

**Files:**
- Modify: `src/integrations/obsidian/TasksAdapter.ts` — implement the currently-stubbed `syncResource()` (line ~190): pull `_TASKS.md` checkbox tasks via `TasksService.listTasks()` and reconcile against native `type:task` notes; surface a one-shot "Import Tasks-plugin tasks → Sauce" command and a "Mirror Sauce tasks → _TASKS.md" command (the latter already half-exists via `TasksEmitter`).
- Modify: `src/main.ts` — register the two commands (existing command region).
- Test: `test/integrations/TasksAdapterSync.test.ts` — round-trip a checkbox line ↔ SauceTask via the existing `TasksEmitter.toCheckbox`/`parseCheckbox` and assert idempotence.
- [ ] TDD the reconcile (match by title+due; status precedence = most-recently-modified); implement; verify against the live vault's `obsidian-tasks-plugin` via `obsidian eval` (`app.plugins.plugins['obsidian-tasks-plugin']?.apiV1`); commit.

### Task 4.4: Expand ICS export to tasks/followups/events

**Files:** Modify `src/importexport/IcsAdapter.ts` `IcsExportAdapter` (line ~54) — currently touches-only; add `VEVENT` emission for `type:task` (DTSTART=due, SUMMARY=title), `followup` (due, trigger), `event` (date+start/end). Test: `test/importexport/IcsExport.test.ts` asserts a task produces a `VEVENT` with `SUMMARY` and ISO `DTSTART`.
- [ ] TDD the per-type mapping; implement; commit.

**Phase 4 gate:** reschedule/quadrant-overlay/bridge/ICS tests green; live drag-reschedule updates a real note; ICS export contains tasks.

---

## Sequencing & Dependencies

- **P1 (mobile)** is fully independent — can ship first for immediate value.
- **P2 (stats)** must precede **P3's** importance-tuning only if you want stat-driven thresholds; otherwise independent. P2 Task 2.1 (`Statistics.ts`) is a dependency for 2.2–2.5.
- **P3 (Eisenhower)** depends on the shared `collectTaskInputs` (Task 3.2) before 3.3.
- **P4** depends on **P3** (quadrant overlay 4.2 needs `EisenhowerEngine`); 4.1/4.3/4.4 are independent of P3.
- Recommended order: **P1 → P2 → P3 → P4**, each merged to `main` at its phase gate (rebase onto `main` first if Wave-2 has landed, reconciling `main.ts` as before).

## Merge & Wave-2 note

`main.ts` is edited in P3 (view/command registration) and P4 (commands) and is also the file the in-flight Wave-2 effort touches. At each phase's merge, use the same surgical pattern proven on 2026-06-19: stash only `main.ts`'s Wave-2 changes, fast-forward/merge, re-apply, reconcile (regions differ). Everything else is disjoint.

## Self-Review Notes (coverage)

- Mobile ask → P1 (Tasks 1.1–1.3, all broken views covered: matrix, heatmap, kanban, graph, dashboard, calendar, modals, tables).
- "deep analytical/mathematical/statistical/algorithmic cross matrix" → P2 (Statistics primitives + CrossMatrixAnalytics correlation matrix + org rollups + z-score outliers + new channel/outcome/degree signals).
- "improve the correlation" → P2 Task 2.3/2.4 (multi-variable matrix beyond the single cadence×closeness Pearson).
- "Eisenhower matrix time prioritization" → P3 (engine + view + dashboard sort).
- "tighten integration with the tasks and calendar plugins and views" → P4 (drag-reschedule, quadrant overlay, obsidian-tasks-plugin two-way bridge, ICS export).
