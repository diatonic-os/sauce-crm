<script lang="ts">
  // Tasks dashboard — group by status, filter by priority/contact,
  // click-through to the task note. Reactive state via Svelte 5 runes.

  import type { TaskRow } from "./DashboardTypes";

  interface Props {
    rows: TaskRow[];
    onOpenPath?: (path: string) => void;
    onMarkDone?: (path: string) => void;
  }

  let { rows, onOpenPath, onMarkDone }: Props = $props();

  // Filter state.
  let filterStatus = $state<string>("all");
  let filterPriority = $state<string>("all");
  let search = $state("");

  // Derived: filtered + grouped rows.
  let filtered = $derived(rows.filter((r) => {
    if (filterStatus !== "all" && r.status !== filterStatus) return false;
    if (filterPriority !== "all" && r.priority !== filterPriority) return false;
    if (search) {
      const q = search.toLowerCase();
      if (!r.title.toLowerCase().includes(q)
        && !(r.contact ?? "").toLowerCase().includes(q)) return false;
    }
    return true;
  }));

  let groups = $derived.by(() => {
    const order = ["todo", "in_progress", "blocked", "done", "cancelled"];
    const map = new Map<string, TaskRow[]>();
    for (const r of filtered) {
      const k = String(r.status);
      const arr = map.get(k) ?? [];
      arr.push(r);
      map.set(k, arr);
    }
    return order.filter((s) => map.has(s)).map((s) => ({ status: s, rows: map.get(s)! }));
  });

  let totals = $derived({
    all: rows.length,
    todo: rows.filter((r) => r.status === "todo").length,
    in_progress: rows.filter((r) => r.status === "in_progress").length,
    blocked: rows.filter((r) => r.status === "blocked").length,
    done: rows.filter((r) => r.status === "done").length,
    cancelled: rows.filter((r) => r.status === "cancelled").length,
  });

  const PRIORITY_COLOR: Record<string, string> = {
    urgent: "var(--color-red)",
    high:   "var(--color-orange)",
    medium: "var(--color-yellow)",
    low:    "var(--color-green)",
  };

  function dueClass(due?: string): string {
    if (!due) return "";
    const today = new Date().toISOString().slice(0, 10);
    if (due < today) return "is-overdue";
    if (due === today) return "is-today";
    return "";
  }
</script>

<div class="sauce-view sauce-tasks">
  <header class="sauce-section-header">
    <h3 style="margin:0">Tasks</h3>
    <span class="sauce-field-help">
      {totals.all} total · {totals.todo} todo · {totals.in_progress} in progress · {totals.blocked} blocked · {totals.done} done
    </span>
  </header>

  <div class="sauce-tasks-filters sauce-section">
    <div class="sauce-field">
      <label class="sauce-field-label" for="sauce-tasks-search">Search</label>
      <input id="sauce-tasks-search" class="sauce-input" type="text" placeholder="title or contact…" bind:value={search} />
    </div>
    <div class="sauce-field">
      <label class="sauce-field-label" for="sauce-tasks-status">Status</label>
      <select id="sauce-tasks-status" class="sauce-input" bind:value={filterStatus}>
        <option value="all">all</option>
        <option value="todo">todo</option>
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
  </div>

  {#if groups.length === 0}
    <p class="sauce-field-help">No tasks match the current filters.</p>
  {:else}
    {#each groups as g}
      <section class="sauce-section">
        <header class="sauce-section-header">
          <h4 style="margin:0">{g.status} <span class="sauce-badge">{g.rows.length}</span></h4>
        </header>
        <ul class="sauce-tasks-list">
          {#each g.rows as t}
            <li class="sauce-task-row {dueClass(t.due)}">
              <button class="sauce-task-title sauce-cal-list-link" onclick={() => onOpenPath?.(t.path)}>
                {t.title}
              </button>
              <div class="sauce-task-meta">
                {#if t.priority}
                  <span class="sauce-badge" style:background={PRIORITY_COLOR[t.priority] ?? "var(--background-modifier-border)"} style:color="white">{t.priority}</span>
                {/if}
                {#if t.due}<span class="sauce-field-help">due {t.due}</span>{/if}
                {#if t.contact}<span class="sauce-field-help">· {t.contact}</span>{/if}
                {#if t.status !== "done" && t.status !== "cancelled" && onMarkDone}
                  <button class="sauce-button-secondary" onclick={() => onMarkDone(t.path)}>Mark done</button>
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
  .sauce-tasks-filters {
    display: grid;
    grid-template-columns: 2fr 1fr 1fr;
    gap: var(--sg-gap-8, 8px);
    align-items: end;
  }
  @media (max-width: 600px) {
    .sauce-tasks-filters { grid-template-columns: 1fr; }
  }
  .sauce-tasks-list {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: var(--sg-gap-5, 5px);
  }
  .sauce-task-row {
    padding: var(--sg-gap-5, 5px) var(--sg-gap-8, 8px);
    background: var(--background-primary);
    border: 1px solid var(--background-modifier-border);
    border-radius: var(--sg-radius-sm, 4px);
    display: flex;
    flex-direction: column;
    gap: 2px;
    overflow-wrap: anywhere;
  }
  .sauce-task-row.is-overdue { border-left: 3px solid var(--color-red); }
  .sauce-task-row.is-today   { border-left: 3px solid var(--color-orange); }
  .sauce-task-title {
    font-weight: 600;
    background: none;
    border: none;
    padding: 0;
    text-align: start;
    cursor: pointer;
    color: var(--text-normal);
  }
  .sauce-task-title:hover { color: var(--interactive-accent); }
  .sauce-task-meta {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--sg-gap-5, 5px);
    font-size: 0.85em;
  }
</style>
