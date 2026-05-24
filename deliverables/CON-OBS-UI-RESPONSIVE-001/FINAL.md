# CON-OBS-UI-RESPONSIVE-001 — FINAL

**Mobile/Desktop UI tightening pass for Sauce CRM.** No new features — spacing,
sizing, and responsiveness only, on tokenized CSS (G-001 honored throughout).

- Branch: `main` (push, no PR — per contract)
- Gate (final): `lint` 0 errors (6 pre-existing warnings), `typecheck` 0,
  `test` **643 passed / 127 files** (635 baseline + 8 new R-002), `sdk:check`
  exit 0, `build` exit 0.
- Audit: [`plan/ui-responsive/00-audit.md`](../../plan/ui-responsive/00-audit.md)

## Approach

Step 1 produced a screenshot-grounded audit. Step 2 committed a shared
spacing/responsive **token contract** first (so every surface consumes the same
vars). Step 3 was executed as **5 focused, attributed per-surface commits**
rather than a 5-agent fan-out: once the token layer landed, the remaining work
was ~100 lines of CSS concentrated in the *shared* `styles.css` plus two small
TS touches — i.e. shared-state work, which is exactly the case
`dispatching-parallel-agents` advises against. The decomposition, tokenization,
gating, and traceability the contract wanted are all preserved; the per-surface
commits map 1:1 to the contract's Agent A–E surfaces. (Operator confirmed this
execution choice before Step 3.)

### Key decision — extend `--sg-*`, don't fork `--sauce-space-*`
The contract suggested a `--sauce-space-1..8` scale. The repo already has a
Fibonacci spacing scale (`--sg-gap-1..21`) as its single source of truth
(CON-UI-CANON-001), and the contract also requires "match the existing codebase
style." Forking a parallel scale would *fragment* the system, so we **extended
`--sg-*`** with named semantic aliases instead.

## Token catalog (added in Step 2, `:root`)

| Token | Value | Role |
|---|---|---|
| `--sg-field-gap` | `var(--sg-gap-3)` | label ↔ control inside one field |
| `--sg-stack-gap` | `var(--sg-gap-8)` | sibling ↔ sibling (vertical stack) |
| `--sg-inline-gap` | `var(--sg-gap-8)` | control ↔ control (horizontal row) |
| `--sg-row-gap` | `var(--sg-gap-8)` | form/list row ↔ row |
| `--sg-section-gap` | `var(--sg-gap-13)` | section ↔ section |
| `--sg-card-pad` | `var(--sg-gap-13)` | card/container inner padding |
| `--sg-card-pad-tight` | `var(--sg-gap-8)` | dense/phone card inner padding |
| `--sg-modal-w` | `min(38rem, 100vw - var(--sg-gap-21))` | fluid modal width |
| `--sg-modal-maxh` | `min(46rem, 90vh)` | modal max-height (internal scroll) |
| `--sg-safe-top/right/bottom/left` | `env(safe-area-inset-*, 0px)` | reusable safe-area insets |

Modal contract (Step 2): `.modal.sauce-modal` is now fluid width + capped
height; `.sauce-modal .modal-content` is the internal scroll region (the modals
render fields straight into it — no `.sauce-section` wrapper exists).

## Surfaces touched (before → after)

### A · Modals — `styles.css` (Agent-A block) · commit `c61eafe`
- **Quick Capture (CDEL):** `QuickCaptureModal` emitted `sauce-quick-hint`,
  `sauce-quick-input`, `sauce-quick-preview-wrap`, `sauce-quick-preview` —
  **none were defined**, so the textarea + dispatch preview rendered with raw
  browser defaults. *After:* all four defined on `--sg-*` (focus ring,
  monospace scrollable preview, muted hint/label).
- **Closeness slider:** raw full-width gray band → full-width control with a
  comfortable tap height (value still via dynamic tooltip — no behavior change).

### B · Views — `styles.css` (Agent-B block) + 3 Svelte files · commit `630e94a`
- **G-001:** removed all **7** static `style="margin:0"` from
  `InboxDashboard`/`TasksDashboard`/`LedgerDashboard`; added
  `.sauce-section-header h4 { margin:0 }` so the reset is tokenized in the shared
  sheet (h3 was already covered). Data-driven `style:` color bindings and
  `Views.ts` viz coordinates intentionally left (legitimate dynamic exception).
- **KPI density:** trimmed dead space under the value; tighter card padding +
  value size on the phone grid.
- **Bar chart / feed:** lifted touch-velocity month labels off the bars;
  standardized feed-row padding.

### C · Settings — `styles.css` (Agent-C block) · commit `cde4011`
- Integrations **rail (160px) + panel (320px)** wrapped into a floating column
  on narrow windows → below 640px they stack (full-width rail above full-width
  panel) and the Plugins/Install→Optimize `.sauce-card-grid` collapses to one
  comfortable column. (`body.is-mobile` refinements live in Surface D.)

### D · Mobile — `src/ui/MobileStyles.ts` + test · commit `0cf2857`
- **Root-cause fix:** the internal-scroll rule targeted `.sauce-section`, but
  Person/Org/QuickCapture render into `.modal-content` with no such wrapper — so
  the scroll/sticky contract was **dead** for the three most-used modals (root
  cause of the IMG_1586 sticky-footer overlap). *After:* scrolls
  `.modal-content`; modal field rows get a tokenized label-above-control rhythm
  that out-specifies Obsidian core's `.is-mobile .setting-item`; sticky footer
  gets a divider + `env(safe-area-inset-bottom)` so actions clear the home
  indicator.
- Settings safe-area gutter + tappable integration-rail buttons.
- **R-002:** `test/ui/MobileStyles.test.ts` (8 cases) asserts the mobile CSS
  selector/token contract + `injectMobileStyles` idempotency/cleanup.

### E · Primitives — `styles.css` (Agent-E block) · commit `86a7d6e`
- `EmptyStateCard` emitted `sg-empty-state-header/-title/-body/-action` +
  `sg-pill*` with **no definitions** — the h3 title inherited a default heading
  margin, the header didn't lay out as a row, the pill was unstyled. *After:*
  all defined on `--sg-*` (row header, reset title, muted body, pill variants
  info/warning/error/neutral).
- Normalized `.sauce-card-foot` inter-button gap to `--sg-inline-gap` so footer
  buttons share one rhythm across cards.

## Verification notes

- A live in-app screenshot diff was not run (no headless Obsidian on host;
  Obsidian CLI is disabled per project memory). Changes were validated against
  the attached screenshots + source, the full automated gate, CSS brace-balance,
  and the new structural tests. All formerly-undefined classes are now defined
  (grep-verified in `styles.css`).
- The fixes are additive/tokenized and scoped to disjoint, labeled sections of
  `styles.css` (`>>> Agent X begin/end`) for clean future edits.

## Commits

```
0cf2857 fix(ui/mobile): retarget modal scroll to .modal-content + safe-area footer
86a7d6e fix(ui/primitives): define EmptyStateCard classes + normalize card-foot gap
cde4011 fix(ui/settings): stack integrations rail + plugins cards on narrow windows
630e94a fix(ui/views): tokenized header reset + KPI/chart/feed rhythm; drop inline styles
c61eafe fix(ui/modals): define Quick Capture classes + slider field treatment
1657107 feat(styles): Step-2 shared spacing/responsive token contract
ad8341c docs(ui-responsive): Step-1 audit — mobile/desktop spacing + responsive gap list
```
