<script lang="ts">
  // Inbox dashboard — overdue + today + upcoming touches & followups.
  // Sorted by urgency: most-overdue first, then today, then upcoming.

  import type { InboxRow } from "./DashboardTypes";

  interface Props {
    rows: InboxRow[];
    onOpenPath?: (path: string) => void;
  }

  let { rows, onOpenPath }: Props = $props();

  let filterKind = $state<"all" | "touch" | "followup">("all");
  let showCompleted = $state(false);

  let filtered = $derived(rows.filter((r) => {
    if (filterKind !== "all" && r.kind !== filterKind) return false;
    // (Completed-status filtering would need the underlying frontmatter;
    // the inbox shows everything for now. `showCompleted` reserved for
    // when the touch schema gains a "responded" field.)
    return showCompleted ? true : true;
  }));

  let buckets = $derived.by(() => {
    const overdue: InboxRow[] = [];
    const today: InboxRow[] = [];
    const upcoming: InboxRow[] = [];
    for (const r of filtered) {
      if (r.daysFromToday < 0) overdue.push(r);
      else if (r.daysFromToday === 0) today.push(r);
      else upcoming.push(r);
    }
    overdue.sort((a, b) => a.daysFromToday - b.daysFromToday);
    upcoming.sort((a, b) => a.daysFromToday - b.daysFromToday);
    return { overdue, today, upcoming };
  });

  const KIND_COLOR: Record<string, string> = {
    touch:    "var(--color-blue)",
    followup: "var(--color-purple)",
  };
</script>

<div class="sauce-view sauce-inbox">
  <header class="sauce-section-header">
    <h3 style="margin:0">Inbox</h3>
    <span class="sauce-field-help">
      {buckets.overdue.length} overdue · {buckets.today.length} today · {buckets.upcoming.length} upcoming
    </span>
  </header>

  <div class="sauce-button-row">
    <button class="sauce-button-secondary" class:is-active={filterKind === "all"} onclick={() => filterKind = "all"}>All</button>
    <button class="sauce-button-secondary" class:is-active={filterKind === "touch"} onclick={() => filterKind = "touch"}>Touches</button>
    <button class="sauce-button-secondary" class:is-active={filterKind === "followup"} onclick={() => filterKind = "followup"}>Followups</button>
  </div>

  {#snippet bucket(title: string, rows: InboxRow[], cls: string)}
    {#if rows.length > 0}
      <section class="sauce-section">
        <header class="sauce-section-header">
          <h4 style="margin:0">{title}</h4>
          <span class="sauce-badge">{rows.length}</span>
        </header>
        <ul class="sauce-inbox-list">
          {#each rows as r}
            <li class="sauce-inbox-row {cls}">
              <span class="sauce-cal-dot" style:background={KIND_COLOR[r.kind]}></span>
              <button class="sauce-cal-list-link" onclick={() => onOpenPath?.(r.path)}>{r.label}</button>
              <span class="sauce-field-help">{r.kind}</span>
              <span class="sauce-field-help">{r.contact}</span>
              <span class="sauce-field-help">{r.date}</span>
              <span class="sauce-field-help">
                {#if r.daysFromToday < 0}{Math.abs(r.daysFromToday)}d overdue
                {:else if r.daysFromToday === 0}today
                {:else}in {r.daysFromToday}d{/if}
              </span>
            </li>
          {/each}
        </ul>
      </section>
    {/if}
  {/snippet}

  {@render bucket("Overdue", buckets.overdue, "is-overdue")}
  {@render bucket("Today", buckets.today, "is-today")}
  {@render bucket("Upcoming", buckets.upcoming, "is-upcoming")}

  {#if filtered.length === 0}
    <p class="sauce-field-help">Inbox is empty for this filter.</p>
  {/if}
</div>

<style>
  .sauce-inbox-list {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: var(--sg-gap-3, 3px);
  }
  .sauce-inbox-row {
    display: grid;
    grid-template-columns: auto 1fr auto auto auto auto;
    gap: var(--sg-gap-8, 8px);
    align-items: center;
    padding: var(--sg-gap-3, 3px) var(--sg-gap-5, 5px);
    overflow-wrap: anywhere;
    background: var(--background-primary);
    border: 1px solid var(--background-modifier-border);
    border-radius: var(--sg-radius-sm, 4px);
  }
  .sauce-inbox-row.is-overdue { border-left: 3px solid var(--color-red); }
  .sauce-inbox-row.is-today   { border-left: 3px solid var(--color-orange); }
  .sauce-inbox-row.is-upcoming{ border-left: 3px solid var(--color-green); }
  @media (max-width: 640px) {
    .sauce-inbox-row {
      grid-template-columns: auto 1fr;
      grid-template-rows: auto auto;
      gap: 2px var(--sg-gap-5, 5px);
    }
  }
  .is-active { background: var(--interactive-accent); color: var(--text-on-accent); border-color: var(--interactive-accent); }
</style>
