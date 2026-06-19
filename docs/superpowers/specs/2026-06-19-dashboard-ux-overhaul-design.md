# Dashboard UX/UI Overhaul — Design Spec

**Date:** 2026-06-19
**Branch:** `feat/dashboard-ux-overhaul` (worktree off `ccfa7d0`, isolated from the
in-flight Wave-2 saucebot work in the main checkout)
**Status:** Draft — awaiting user review

## Goal

Make every SauceOM dashboard/view operationally usable in practice with real
vault data: pixel-perfect, readable, interactive, with functional components,
real calculations/correlations, and algorithmic data-driven suggestions —
proven by a Playwright UX/UI audit, then merged to `main`.

## Definition of Done

A view is "done" when:
1. It renders with **real vault data** (no dead/empty components where data exists).
2. Every interactive control is **functional** (filters filter, buttons act,
   links open the right note).
3. Computed metrics are **correct** (verified against the underlying notes).
4. Where applicable, it surfaces **data-driven suggestions** from the analytics layer.
5. It passes the **Playwright visual + functional check** against the live vault.

The overhaul is "done" when all waves are green (build/lint/test) AND the full
Playwright audit passes AND it is merged to `main` in one reviewed merge.

## Key Architectural Insight (de-risks isolation)

Dashboards collect data by **frontmatter `type`, not by folder** (e.g.
`collectTaskRows()` scans all markdown and keeps `fm.type === "task"`). Therefore
the `.sauceBrain` seen/hidden reorg does **not** change what data views show, and
this UI work is independent of the entangled, currently-broken Wave-2 churn. We
build on a clean worktree off `ccfa7d0` and never touch the in-flight files.

## Baseline Audit (live, Sauce_Relationship_Graph, 2026-06-19)

23 views opened live via `obsidian eval`. **Zero render errors** (the
`open()`-shadowing fix holds across the surface). Findings:

- **Working / data-rich:** dashboard, inbox (94 rows), ledger (24), calendar
  (42 cells), ai-inbox, audit-log (51), graph-view, hierarchy, overdue, lanes,
  meetings, copilot-chat.
- **Data-correctness defect:** `tasks-board` shows the empty-state ("No tasks
  match…") despite the vault containing data — collection/filter bug to root-cause.
- **Thin / not surfacing data:** pipeline (0 rows), weekly (0), parent-dashboard
  (138 chars), compat (0 rows), heatmap (86 chars, 0 rows).
- **Stub / placeholder:** map, crm-map, sync-status (no `sauce-view` class,
  ~90 chars, 0–1 controls), brain (no class, 86 chars).
- **Interactivity gap (systemic):** most static views expose only a single
  header help button (`buttons:1, inputs:0`) — read-only where they should be
  interactive (sort, filter, drill-down, act).

## Wave Plan

Each wave is one coherent, independently-testable slice. Per-wave gate:
`build PASS, lint PASS, tests PASS, Playwright validation PASS` before merge-up.

- **W0 — Design system foundation.** Audit + codify the shared `sauce-view`
  CSS tokens, spacing, typography, empty-state, and interactive-control patterns
  the Svelte dashboards already use; extract reusable components (filter bar,
  data table, metric tile, empty-state) so later waves are consistent and fast.
- **W1 — Svelte dashboards** (Tasks/Inbox/Ledger/Calendar). Fix the Tasks data
  defect; pixel-perfect pass; ensure filters/sort/actions functional; add
  computed summary metrics.
- **W2 — FolderIndex + log views** (Meetings/Lanes/Weekly/AIInbox/Audit/SkillRun).
  Replace thin/static renders with interactive, sortable, data-rich tables;
  fix empty surfaces (weekly, parent-dashboard).
- **W3 — Analytical views** (Pipeline/Compat/Heatmap/Hierarchy/Overdue/Graph).
  Surface real data (pipeline deals, compatibility matrix, touch heatmap);
  make them interactive (drill-down, hover, filter).
- **W4 — Navigation surface.** Tool-icon dropdowns / ribbon / command menus;
  reconcile "seen vs hidden"; repair stub views (map/crm-map/sync-status/brain)
  or retire them explicitly.
- **W5 — Analytics engine.** Net-new service: real calculations, correlations
  (e.g. touch cadence vs closeness, pipeline velocity, relationship-strength
  scoring), and algorithmic data-driven suggestions ("overdue to reconnect",
  "stalled deal", "high-value low-touch"). Surface into the dashboards from W1–W3.

## Eval Methodology

- **Live introspection:** `obsidian eval` opens each view and asserts render
  state, control counts, data-row counts, and computed-metric correctness.
- **Playwright:** drives the Obsidian Electron window for visual snapshots and
  functional interaction (click filters, verify rows change, open notes).
  Obsidian is a single shared instance, so eval/Playwright runs are **serial**,
  never parallel.
- **Vault:** `Sauce_Relationship_Graph` (live, real data) per user choice.
  Interactions are read-mostly; any mutation path is verified non-destructive first.

## Risks & Mitigations

- **Shared Obsidian instance** → serialize all eval/Playwright; no parallel agents
  against the live window.
- **Main-tree Wave-2 churn** → fully isolated worktree; never edit in-flight files.
- **Live-vault interaction** → read-mostly audit; confirm any write path is safe
  before invoking it; deploy worktree build (no `.sauceBrain` migration in
  `ccfa7d0`, so auditing won't migrate data).
- **Scope** → wave gates keep each slice shippable; merge only when all green.

## Out of Scope

- The `.sauceBrain` consolidation + Wave-2 saucebot harness (owned by the other
  session; we build around it, not on it).
- Mobile-specific layout beyond existing responsive breakpoints (revisit post-overhaul).
