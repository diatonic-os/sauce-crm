<script lang="ts">
  // Tasks dashboard — group by status, filter by status/priority/contact,
  // search, sort, and click-through to the task note. Reactive state via
  // Svelte 5 runes.
  //
  // DATA-CORRECTNESS FIX (2026-06-19): the previous `groups` derived only
  // emitted rows whose status matched a hard-coded 5-value allow-list. Any
  // task carrying a legacy / unexpected status (e.g. "in-progress" with a
  // hyphen, an unmapped value, or a stray-cased value) was silently dropped
  // from every group, so `groups.length === 0` fired the empty-state EVEN
  // WHEN `filtered` held rows — the reported "No tasks match" defect. We now
  // (a) bucket EVERY present status (known statuses in canonical order first,
  // then any unknown statuses appended), and (b) gate the empty-state on
  // `filtered.length`, not `groups.length`, so no real data ever disappears.

  import type { TaskRow } from "./DashboardTypes";
  import type { Quadrant } from "@/services/tasks/EisenhowerEngine";

  const QUADRANT_ORDER: Quadrant[] = ["do", "schedule", "delegate", "eliminate"];
  const QUADRANT_LABEL: Record<Quadrant, string> = {
    do: "Q1·Do",
    schedule: "Q2·Schedule",
    delegate: "Q3·Delegate",
    eliminate: "Q4·Eliminate",
  };

  interface Props {
    rows: TaskRow[];
    onOpenPath?: (path: string) => void;
    onMarkDone?: (path: string) => void;
  }

  let { rows, onOpenPath, onMarkDone }: Props = $props();

  // ── Filter / sort state ───────────────────────────────────────────────
  let filterStatus = $state<string>("all");
  let filterPriority = $state<string>("all");
  let filterContact = $state<string>("all");
  let search = $state("");
  let sortBy = $state<"status" | "due" | "priority" | "title" | "quadrant">("status");

  const STATUS_ORDER = ["todo", "in_progress", "blocked", "done", "cancelled"];
  const STATUS_LABEL: Record<string, string> = {
    todo: "To do",
    in_progress: "In progress",
    blocked: "Blocked",
    done: "Done",
    cancelled: "Cancelled",
  };
  const PRIORITY_RANK: Record<string, number> = {
    urgent: 0,
    high: 1,
    medium: 2,
    low: 3,
  };
  const PRIORITY_COLOR: Record<string, string> = {
    urgent: "var(--color-red)",
    high: "var(--color-orange)",
    medium: "var(--color-yellow)",
    low: "var(--color-green)",
  };

  const statusLabel = (s: string): string =>
    STATUS_LABEL[s] ?? s.replace(/[_-]/g, " ");

  // Contact options derived from the data, so the filter only offers values
  // that actually exist.
  let contactOptions = $derived.by(() => {
    const set = new Set<string>();
    for (const r of rows) if (r.contact) set.add(r.contact);
    return ["all", ...[...set].sort((a, b) => a.localeCompare(b))];
  });

  // ── Derived: filtered rows ────────────────────────────────────────────
  let filtered = $derived(
    rows.filter((r) => {
      if (filterStatus !== "all" && r.status !== filterStatus) return false;
      if (filterPriority !== "all" && r.priority !== filterPriority)
        return false;
      if (filterContact !== "all" && r.contact !== filterContact) return false;
      if (search) {
        const q = search.toLowerCase();
        if (
          !r.title.toLowerCase().includes(q) &&
          !(r.contact ?? "").toLowerCase().includes(q) &&
          !(r.tags ?? []).some((t) => t.toLowerCase().includes(q))
        )
          return false;
      }
      return true;
    }),
  );

  function sortRows(arr: TaskRow[]): TaskRow[] {
    const out = [...arr];
    if (sortBy === "due") {
      // Undated tasks sink to the bottom; earliest due first.
      out.sort((a, b) => (a.due ?? "9999").localeCompare(b.due ?? "9999"));
    } else if (sortBy === "priority") {
      out.sort(
        (a, b) =>
          (PRIORITY_RANK[a.priority ?? ""] ?? 99) -
          (PRIORITY_RANK[b.priority ?? ""] ?? 99),
      );
    } else if (sortBy === "title") {
      out.sort((a, b) => a.title.localeCompare(b.title));
    } else if (sortBy === "quadrant") {
      out.sort((a, b) => {
        const ai = a.quadrant ? QUADRANT_ORDER.indexOf(a.quadrant) : 99;
        const bi = b.quadrant ? QUADRANT_ORDER.indexOf(b.quadrant) : 99;
        return ai - bi;
      });
    }
    return out;
  }

  // ── Derived: groups — EVERY present status appears (the fix). ─────────
  let groups = $derived.by(() => {
    const map = new Map<string, TaskRow[]>();
    for (const r of filtered) {
      const k = String(r.status || "todo");
      const arr = map.get(k) ?? [];
      arr.push(r);
      map.set(k, arr);
    }
    // Known statuses in canonical order, then any unknown statuses (sorted)
    // so nothing is ever silently dropped.
    const known = STATUS_ORDER.filter((s) => map.has(s));
    const unknown = [...map.keys()]
      .filter((s) => !STATUS_ORDER.includes(s))
      .sort((a, b) => a.localeCompare(b));
    return [...known, ...unknown].map((s) => ({
      status: s,
      rows: sortRows(map.get(s)!),
    }));
  });

  const todayIso = (): string => new Date().toISOString().slice(0, 10);

  // ── Derived: summary tiles ────────────────────────────────────────────
  let summary = $derived.by(() => {
    const t = todayIso();
    let open = 0;
    let overdue = 0;
    let dueToday = 0;
    for (const r of rows) {
      const isClosed = r.status === "done" || r.status === "cancelled";
      if (!isClosed) {
        open += 1;
        if (r.due && r.due < t) overdue += 1;
        else if (r.due === t) dueToday += 1;
      }
    }
    return {
      all: rows.length,
      open,
      overdue,
      dueToday,
      done: rows.filter((r) => r.status === "done").length,
    };
  });

  function dueClass(r: TaskRow): string {
    if (!r.due || r.status === "done" || r.status === "cancelled") return "";
    const t = todayIso();
    if (r.due < t) return "is-overdue";
    if (r.due === t) return "is-today";
    return "";
  }

  function dueLabel(due: string): string {
    const t = todayIso();
    if (due < t) return `overdue · ${due}`;
    if (due === t) return "due today";
    return `due ${due}`;
  }
</script>

<div class="sauce-view sauce-tasks">
  <header class="sauce-tasks-summary" aria-label="Task summary">
    <div class="sauce-tile">
      <span class="sauce-tile-value">{summary.all}</span>
      <span class="sauce-tile-label">total</span>
    </div>
    <div class="sauce-tile">
      <span class="sauce-tile-value">{summary.open}</span>
      <span class="sauce-tile-label">open</span>
    </div>
    <div class="sauce-tile" class:is-alert={summary.overdue > 0}>
      <span class="sauce-tile-value">{summary.overdue}</span>
      <span class="sauce-tile-label">overdue</span>
    </div>
    <div class="sauce-tile" class:is-warn={summary.dueToday > 0}>
      <span class="sauce-tile-value">{summary.dueToday}</span>
      <span class="sauce-tile-label">due today</span>
    </div>
    <div class="sauce-tile">
      <span class="sauce-tile-value">{summary.done}</span>
      <span class="sauce-tile-label">done</span>
    </div>
  </header>

  <div class="sauce-tasks-filters sauce-section">
    <div class="sauce-field">
      <label class="sauce-field-label" for="sauce-tasks-search">Search</label>
      <input
        id="sauce-tasks-search"
        class="sauce-input"
        type="text"
        placeholder="title, contact, or tag…"
        bind:value={search}
      />
    </div>
    <div class="sauce-field">
      <label class="sauce-field-label" for="sauce-tasks-status">Status</label>
      <select id="sauce-tasks-status" class="sauce-input" bind:value={filterStatus}>
        <option value="all">all</option>
        <option value="todo">to do</option>
        <option value="in_progress">in progress</option>
        <option value="blocked">blocked</option>
        <option value="done">done</option>
        <option value="cancelled">cancelled</option>
      </select>
    </div>
    <div class="sauce-field">
      <label class="sauce-field-label" for="sauce-tasks-priority">Priority</label>
      <select id="sauce-tasks-priority" class="sauce-input" bind:value={filterPriority}>
        <option value="all">all</option>
        <option value="urgent">urgent</option>
        <option value="high">high</option>
        <option value="medium">medium</option>
        <option value="low">low</option>
      </select>
    </div>
    <div class="sauce-field">
      <label class="sauce-field-label" for="sauce-tasks-contact">Contact</label>
      <select id="sauce-tasks-contact" class="sauce-input" bind:value={filterContact}>
        {#each contactOptions as c}<option value={c}>{c}</option>{/each}
      </select>
    </div>
    <div class="sauce-field">
      <label class="sauce-field-label" for="sauce-tasks-sort">Sort</label>
      <select id="sauce-tasks-sort" class="sauce-input" bind:value={sortBy}>
        <option value="status">status (grouped)</option>
        <option value="due">due date</option>
        <option value="priority">priority</option>
        <option value="title">title (A→Z)</option>
        <option value="quadrant">quadrant (Eisenhower)</option>
      </select>
    </div>
  </div>

  {#if filtered.length === 0}
    <p class="sauce-empty">
      {#if rows.length === 0}
        No tasks in the vault yet.
      {:else}
        No tasks match the current filters.
      {/if}
    </p>
  {:else}
    {#each groups as g (g.status)}
      <section class="sauce-section">
        <header class="sauce-section-header">
          <h4 class="sauce-status-head">
            <span class="sauce-status-dot status-{g.status}"></span>
            {statusLabel(g.status)}
            <span class="sauce-badge">{g.rows.length}</span>
          </h4>
        </header>
        <ul class="sauce-tasks-list">
          {#each g.rows as t (t.path)}
            <li class="sauce-task-row {dueClass(t)}">
              <button
                class="sauce-task-title"
                onclick={() => onOpenPath?.(t.path)}
                title="Open {t.title}"
              >
                {t.title}
              </button>
              <div class="sauce-task-meta">
                {#if t.priority}
                  <span
                    class="sauce-prio"
                    style:--prio-color={PRIORITY_COLOR[t.priority] ??
                      "var(--text-muted)"}>{t.priority}</span
                  >
                {/if}
                {#if t.due}
                  <span class="sauce-task-due">{dueLabel(t.due)}</span>
                {/if}
                {#if t.contact}
                  <span class="sauce-task-contact">{t.contact}</span>
                {/if}
                {#if t.quadrant}
                  <span class="sauce-badge sauce-eis-pill sauce-eis-pill-{t.quadrant}">{QUADRANT_LABEL[t.quadrant]}</span>
                {/if}
                {#each t.tags ?? [] as tag}
                  <span class="sauce-tag">#{tag}</span>
                {/each}
                {#if t.status !== "done" && t.status !== "cancelled" && onMarkDone}
                  <button
                    class="sauce-button-secondary sauce-task-action"
                    onclick={() => onMarkDone(t.path)}
                    title="Mark this task done"
                  >
                    Mark done
                  </button>
                {/if}
              </div>
            </li>
          {/each}
        </ul>
      </section>
    {/each}
  {/if}
</div>

<style>
  .sauce-tasks {
    display: flex;
    flex-direction: column;
    gap: var(--size-4-2);
  }

  /* ── Summary tiles ──────────────────────────────────────────────────── */
  .sauce-tasks-summary {
    display: grid;
    grid-template-columns: repeat(5, 1fr);
    gap: var(--size-4-2);
  }
  @media (max-width: 600px) {
    .sauce-tasks-summary { grid-template-columns: repeat(2, 1fr); }
  }
  .sauce-tile {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 2px;
    padding: var(--size-4-2) var(--size-2-2);
    background: var(--background-secondary);
    border: 1px solid var(--background-modifier-border);
    border-radius: var(--radius-s);
    text-align: center;
  }
  .sauce-tile.is-alert {
    border-color: var(--color-red);
    background: color-mix(in srgb, var(--color-red) 10%, var(--background-secondary));
  }
  .sauce-tile.is-warn {
    border-color: var(--color-orange);
    background: color-mix(in srgb, var(--color-orange) 10%, var(--background-secondary));
  }
  .sauce-tile-value {
    font-size: var(--font-ui-large);
    font-weight: 700;
    line-height: 1.1;
    color: var(--text-normal);
  }
  .sauce-tile-label {
    font-size: var(--font-ui-smaller);
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  /* ── Filter bar ─────────────────────────────────────────────────────── */
  .sauce-tasks-filters {
    display: grid;
    grid-template-columns: 2fr repeat(4, 1fr);
    gap: var(--size-4-2);
    align-items: end;
  }
  @media (max-width: 800px) {
    .sauce-tasks-filters { grid-template-columns: 1fr 1fr; }
  }
  @media (max-width: 480px) {
    .sauce-tasks-filters { grid-template-columns: 1fr; }
  }

  /* ── Status group headers ───────────────────────────────────────────── */
  .sauce-status-head {
    display: flex;
    align-items: center;
    gap: var(--size-2-2);
    margin: 0;
    text-transform: capitalize;
  }
  .sauce-status-dot {
    width: 9px;
    height: 9px;
    border-radius: 50%;
    flex: 0 0 auto;
    background: var(--text-muted);
  }
  .status-todo { background: var(--color-blue); }
  .status-in_progress { background: var(--color-orange); }
  .status-blocked { background: var(--color-red); }
  .status-done { background: var(--color-green); }
  .status-cancelled { background: var(--text-faint); }

  /* ── Task rows ──────────────────────────────────────────────────────── */
  .sauce-tasks-list {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: var(--size-2-2);
  }
  .sauce-task-row {
    padding: var(--size-2-2) var(--size-4-2);
    background: var(--background-primary);
    border: 1px solid var(--background-modifier-border);
    border-radius: var(--radius-s);
    border-left: 3px solid transparent;
    display: flex;
    flex-direction: column;
    gap: var(--size-2-1);
    overflow-wrap: anywhere;
    transition: background 0.1s ease, border-color 0.1s ease;
  }
  .sauce-task-row:hover { background: var(--background-modifier-hover); }
  .sauce-task-row.is-overdue { border-left-color: var(--color-red); }
  .sauce-task-row.is-today { border-left-color: var(--color-orange); }

  .sauce-task-title {
    font-weight: var(--font-semibold);
    background: none;
    border: none;
    padding: 0;
    text-align: start;
    cursor: pointer;
    color: var(--text-normal);
    font-size: var(--font-ui-medium);
  }
  .sauce-task-title:hover { color: var(--interactive-accent); text-decoration: underline; }
  .sauce-task-title:focus-visible {
    outline: 2px solid var(--interactive-accent);
    outline-offset: 2px;
    border-radius: var(--radius-s);
  }

  .sauce-task-meta {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--size-2-2);
    font-size: var(--font-ui-smaller);
    color: var(--text-muted);
  }
  .sauce-prio {
    text-transform: uppercase;
    font-size: var(--font-ui-smaller);
    font-weight: var(--font-semibold);
    letter-spacing: 0.03em;
    padding: 1px var(--size-2-2);
    border-radius: var(--radius-s);
    color: var(--prio-color);
    border: 1px solid var(--prio-color);
  }
  .sauce-task-due { color: var(--text-muted); }
  .is-overdue .sauce-task-due { color: var(--color-red); font-weight: var(--font-semibold); }
  .is-today .sauce-task-due { color: var(--color-orange); font-weight: var(--font-semibold); }
  .sauce-task-contact::before { content: "@"; opacity: 0.6; }
  .sauce-tag {
    color: var(--text-accent);
    font-size: var(--font-ui-smaller);
  }
  .sauce-task-action {
    margin-inline-start: auto;
    cursor: pointer;
  }

  .sauce-empty {
    color: var(--text-muted);
    text-align: center;
    padding: var(--size-4-8) var(--size-4-2);
    background: var(--background-secondary);
    border: 1px dashed var(--background-modifier-border);
    border-radius: var(--radius-s);
  }
</style>
