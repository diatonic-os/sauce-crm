# CON-OBS-UI-RESPONSIVE-001 — Step 1 Audit

> UI/UX spacing + responsiveness gap list. Grounded in 10 mobile screenshots
> (`IMG_1586`–`IMG_1595`) cross-referenced against the live source in
> `styles.css`, `src/ui/MobileStyles.ts`, and the render code for each surface.
> No new features — spacing/sizing/responsiveness only.

## Screenshot ↔ surface map

| Shot(s) | Surface | Render source |
|---|---|---|
| 1586, 1587 | New Person modal (scroll top + bottom) | `src/ui/modals/PersonModal.ts` |
| 1594, 1595 | New Org modal (idle + keyboard-open) | `src/ui/modals/OrgModal.ts` |
| 1588, 1589 | Quick Capture (CDEL) modal | `src/ui/modals/v2/QuickCaptureModal.ts` |
| 1590–1593 | Sauce Dashboard view (4 scroll states) | `src/ui/views/v2/DashboardViews.ts` + `Views.ts` |

## How the styling actually resolves (root-cause context)

- Desktop design language lives in `styles.css` on `--sg-*` Fibonacci tokens
  (`--sg-gap-1..21`, `--sg-w-*`, `--sg-h-*`, `--sg-radius-*`, `--sg-tap-min`).
- Mobile overrides are injected at runtime by `injectMobileStyles()`
  (`MobileStyles.ts`) as a `<style>` scoped under `body.is-mobile`.
- **Specificity trap:** the field-card look (`.sauce-modal .setting-item`,
  specificity 0,2,0) is beaten on phone by Obsidian core's `.is-mobile
  .setting-item` (0,2,1). So `PersonModal`/`OrgModal` fields fall back to core
  divider-rows on mobile (visible in 1586/1594) — the intentional spacing is
  lost, not applied. Fixing mobile requires `body.is-mobile .sauce-modal
  .setting-item` rules that out-specify core.

---

## A — Modals (`src/ui/modals/**`, `src/ui/modals/v2/**`)

### A1. New Person / New Org field rhythm is inconsistent (1586, 1587, 1594)
- **Observed:** label sits tight on its input (≈3px) while row-to-row gap is
  large and separated by a full-width hairline divider; the form reads as a
  long undifferentiated list rather than grouped fields. Density differs from
  the desktop card treatment because core mobile `.setting-item` wins (see
  root-cause above).
- **Gap:** no `body.is-mobile .sauce-modal .setting-item` rule → vertical
  rhythm is whatever Obsidian core defaults to, not tokenized.
- **Fix surface:** Agent D (mobile) defines tokenized `.sauce-modal
  .setting-item` spacing on phone (label↔control gap, row padding, divider
  treatment) consuming `--sg-gap-*`.

### A2. Closeness slider renders as a raw full-width gray band (1586)
- **Observed:** the `addSlider` control fills the row in a flat gray track with
  a floating thumb; no inline current-value, no 1–5 min/max anchors. Looks
  unfinished next to the other fields.
- **Gap:** no `.sauce-modal input[type="range"]` / slider container token rule.
- **Fix surface:** Agent A (modals) — add a tokenized slider row treatment
  (sizing/padding only; `setDynamicTooltip()` already gives the value on drag,
  so no behavior change needed).

### A3. Sticky footer overlaps trailing content (1586)
- **Observed:** the Save/Cancel row appears with a stray `+ Add (0)` button
  *below* it — content bleeds under the action bar.
- **Cause:** `MobileStyles.ts` pins `.sauce-modal .sauce-buttons` to
  `position: sticky; bottom: 0`, but `PersonModal`/`OrgModal`/`QuickCapture`
  put fields **directly in `contentEl`** with no `.sauce-section` wrapper — so
  the intended internal-scroll container (`.sauce-modal .sauce-section
  { max-height: 72vh; overflow-y:auto }`) never matches. The sticky bar floats
  over the modal-content scroll instead of capping a defined scroll region, and
  lacks a top divider/elevation so overlap is invisible until it happens.
- **Fix surface:** Agent A (TS — wrap field stack in a scroll container class)
  + Agent D (mobile — give the sticky footer a top border + safe-area padding
  and target the new container). R-002: assert the wrapper class is emitted.

### A4. Quick Capture textarea + preview are completely unstyled (1588, 1589)
- **Observed:** the CDEL textarea and "Will dispatch:" `<pre>` use browser
  defaults; on keyboard-open (1588) the preview + Dispatch/Cancel get cramped
  against the keyboard.
- **Cause — confirmed gap:** `QuickCaptureModal.ts` emits classes
  `sauce-quick-hint`, `sauce-quick-input`, `sauce-quick-preview-wrap`,
  `sauce-quick-preview` that **do not exist in `styles.css`** (grep: 0 hits).
  Only `.sauce-quick-capture` (the container) is referenced, and only in
  `MobileStyles.ts`.
- **Fix surface:** Agent A defines the four missing classes on tokens
  (textarea min-height/padding/radius/border, hint muted small, preview
  monospace scroll box, wrap gap) + Agent D ensures keyboard-safe bottom inset
  on the sticky footer for this modal. R-002: assert the four classes resolve.

### A5. Modal width/height contract is fixed, not fluid (1586/1594 desktop parity)
- **Observed (code):** `.modal.sauce-modal { width: min(610px, 100vw - 21px) }`
  and on phone `width: 100vw; max-height: 100vh`. No `max-height` with internal
  scroll on desktop → tall modals (PersonModal has 9 fields) can exceed the
  viewport with no internal scroll region.
- **Fix surface:** Step 2 token layer — `max-height: min(Xrem, 90vh)` +
  internal scroll on the field container; full-bleed + safe-area on phone.

---

## B — Views (`src/ui/views/**`, `src/ui/svelte/*.svelte`)

### B1. Dashboard KPI cards waste vertical space / odd-card dangle (1590)
- **Observed:** 2-col KPI grid (`.sauce-view-kpis`, `minmax(--sg-w-144,1fr)`);
  each `.sauce-kpi` has generous internal padding with the value pinned high
  and dead space below; the 13th card (ADDENDA) dangles alone on a row.
- **Gap:** padding not tuned for the dense phone grid; min track width (144px)
  forces exactly 2 cols with slack. Spacing is tokenized but not tightened for
  mobile.
- **Fix surface:** Agent B + Agent D — tighten `.sauce-kpi` block padding and
  value margin on phone; no count/behavior change.

### B2. Bar chart month labels crowd the axis (1591)
- **Observed:** Touch Velocity bars with `06 07 08 …` labels run tight under a
  150px-min chart; labels nearly touch.
- **Gap:** `.sauce-bar-chart` gap (`--sg-gap-5`) + `.sauce-bar-label` 0.7em with
  no row gap between bar and label.
- **Fix surface:** Agent B — add label spacing token; **note** bar heights are
  data-driven inline `style.height` in `Views.ts:239` (legitimate dynamic
  exception — leave the JS, only adjust label CSS).

### B3. Recent-touches / Ideas list rows are tight (1592, 1593)
- **Observed:** `[[Name]]` title with date directly beneath, minimal row
  padding, rows nearly flush.
- **Fix surface:** Agent B / Agent E — standardize `.sauce-list-row` /
  feed-row vertical padding + title↔meta gap via `--sg-gap-*`.

### B4. Svelte dashboards use inline `style="margin:0"` — G-001 violations
- **Observed (grep):** 6 hits — `InboxDashboard.svelte:47,63`,
  `TasksDashboard.svelte:71,111`, `LedgerDashboard.svelte:64,97,118`
  (`<h3|h4 style="margin:0">`).
- **Fix surface:** Agent B — drop inline styles; extend
  `.sauce-section-header h3` rule to cover `h4`, or add a tokenized header
  class. (`Views.ts` `.style.*` at 239/500–574 are data-driven viz coordinates
  — **not** G-001 targets; leave them.)

---

## C — Settings (`src/ui/settings/**`)

> Not in the screenshot set, but in scope. Audited from `styles.css` + sources.

### C1. Settings rows already tokenized but mobile collapse is generic
- **Observed (code):** `.sg-tab-content .setting-item` are well-tokenized cards
  on desktop; on phone `body.is-mobile .setting-item { display:block; padding:
  8px 0 }` flattens *all* setting-items uniformly, including the Plugins/
  Install→Optimize cards and the integrations rail.
- **Gap:** the integrations rail (`.sg-integrations-rail`, `min-width:160px`) +
  panel (`flex:1 1 320px`) can wrap awkwardly on narrow phones; card foot
  buttons stack but row padding isn't phone-tuned.
- **Fix surface:** Agent C + Agent D — phone-scope the Plugins cards and
  integrations layout (full-width rail, stacked panel, tokenized gaps).

### C2. No safe-area padding on scrolling settings tab content
- **Fix surface:** Agent D — apply `env(safe-area-inset-bottom)` to the
  settings scroll container like `.sauce-view` already does.

---

## D — Mobile layer (`src/ui/MobileStyles.ts`)

### D1. Modal scroll/footer contract targets a wrapper that modals don't emit
- **Observed (code):** `body.is-mobile .sauce-modal .sauce-section { max-height:
  72vh; overflow-y:auto }` — but `PersonModal`/`OrgModal`/`QuickCaptureModal`
  emit **no `.sauce-section`**. The contract is dead for the three most-used
  modals. (Root cause behind A3.)
- **Fix surface:** Agent D — retarget the scroll/sticky rules to a wrapper that
  the modals actually emit (coordinate with Agent A's new container class), or
  to `.sauce-modal .modal-content`.

### D2. Field cards lose intended spacing on phone (root cause of A1)
- **Fix surface:** Agent D — add `body.is-mobile .sauce-modal .setting-item`
  with tokenized label↔control gap + row padding to out-specify core.

### D3. Safe-area applied to views but not to all sticky surfaces
- **Observed:** `.sauce-view`/`.sauce-copilot`/`.sauce-copilot-input` honor
  `env(safe-area-inset-*)`, but sticky modal footers only get
  `--sg-mobile-bottom` on `.sauce-modal` padding, not on the sticky button row
  itself → on home-indicator phones the buttons can sit under the indicator.
- **Fix surface:** Agent D — add safe-area bottom padding to the sticky footer.

---

## E — Shared primitives (`src/ui/components/**`, `src/ui/widgets/**`)

### E1. Card foot / button rows inconsistent gap tokens
- **Observed (code):** `.sauce-card-foot` uses `--sg-gap-3`, `.sauce-button-row`
  uses `--sg-gap-8`, `.sauce-buttons` uses `--sg-gap-8` — minor inconsistency in
  inter-button spacing across primitives.
- **Fix surface:** Agent E — normalize to one inter-control gap token.

### E2. `EmptyStateCard`, `StatusRow`, `QuickActionRow`, banners
- **Fix surface:** Agent E — verify each consumes `--sg-gap-*` for
  container↔child padding; tighten any hardcoded one-offs. (Audit per-file
  during dispatch.)

---

## Cross-cutting / Step-2 token contract (blocks fan-out)

1. **Keep `--sg-*` as the single source of truth** (do **not** fork a parallel
   `--sauce-space-1..8` scale — that would fragment CON-UI-CANON-001 and violate
   "match existing codebase style"). Add **semantic spacing aliases** layered on
   the Fibonacci scale so intent is named (e.g. `--sg-space-stack`,
   `--sg-space-inline`, `--sg-field-gap`, `--sg-section-gap`) → all `= var(--sg-gap-*)`.
2. **Fluid sizing tokens:** `--sg-modal-w: min(38rem, calc(100vw - var(--sg-gap-21)))`,
   `--sg-modal-maxh: min(46rem, 90vh)`, plus `clamp()` type already in
   `--sg-mobile-font`.
3. **Safe-area tokens:** promote `--sg-mobile-bottom` / add
   `--sg-safe-top/right/left` for reuse beyond `.sauce-view`.
4. **Modal contract:** `max-height` + internal scroll region; full-bleed +
   safe-area on phone; sticky footer with divider + safe-area inset.
5. **Container queries** where supported (KPI/card grids) with `@media`
   fallbacks for `.is-phone` / narrow windows.
6. **Surface-scoped section delimiters** added to `styles.css` so parallel
   agents edit only their labeled block (near-zero merge thrash).

## Guardrails restated
- G-001: tokenized classes only — no `el.style.*`/`style=` for spacing
  (data-driven viz coords in `Views.ts` excepted).
- No behavior changes; spacing/sizing/responsiveness only.
- Per-change 4-gate green (`lint`/`typecheck`/`test`/`sdk:check`) + `build`;
  baseline = **635 tests / 126 files**, build exit 0.
- R-002: where structure/classes change, add/adjust a vitest assertion on
  classes/structure (not pixel values).
