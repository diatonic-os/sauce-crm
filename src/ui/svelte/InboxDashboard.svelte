<script lang="ts">
  // Inbox dashboard — overdue + today + upcoming touches & followups,
  // bucketed by urgency and sorted most-overdue first. Svelte 5 runes.

  import type { InboxRow } from "./DashboardTypes";

  interface Props {
    rows: InboxRow[];
    onOpenPath?: (path: string) => void;
  }

  let { rows, onOpenPath }: Props = $props();

  let filterKind = $state<"all" | "touch" | "followup">("all");
  let filterContact = $state<string>("all");
  let search = $state("");

  let contactOptions = $derived.by(() => {
    const set = new Set<string>();
    for (const r of rows) if (r.contact && r.contact !== "?") set.add(r.contact);
    return ["all", ...[...set].sort((a, b) => a.localeCompare(b))];
  });

  let filtered = $derived(
    rows.filter((r) => {
      if (filterKind !== "all" && r.kind !== filterKind) return false;
      if (filterContact !== "all" && r.contact !== filterContact) return false;
      if (search) {
        const q = search.toLowerCase();
        if (
          !r.label.toLowerCase().includes(q) &&
          !r.contact.toLowerCase().includes(q)
        )
          return false;
      }
      return true;
    }),
  );

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
    today.sort((a, b) => a.contact.localeCompare(b.contact));
    return { overdue, today, upcoming };
  });

  // Summary is computed over ALL rows (not the current filter) so the tiles
  // give a stable picture of the whole inbox.
  let summary = $derived.by(() => {
    let overdue = 0;
    let today = 0;
    let upcoming = 0;
    let touches = 0;
    let followups = 0;
    for (const r of rows) {
      if (r.daysFromToday < 0) overdue += 1;
      else if (r.daysFromToday === 0) today += 1;
      else upcoming += 1;
      if (r.kind === "touch") touches += 1;
      else followups += 1;
    }
    return { all: rows.length, overdue, today, upcoming, touches, followups };
  });

  const KIND_COLOR: Record<string, string> = {
    touch: "var(--color-blue)",
    followup: "var(--color-purple)",
  };

  function whenLabel(days: number): string {
    if (days < 0) return `${Math.abs(days)}d overdue`;
    if (days === 0) return "today";
    if (days === 1) return "tomorrow";
    return `in ${days}d`;
  }
</script>

<div class="sauce-view sauce-inbox">
  <header class="sauce-inbox-summary" aria-label="Inbox summary">
    <div class="sauce-tile" class:is-alert={summary.overdue > 0}>
      <span class="sauce-tile-value">{summary.overdue}</span>
      <span class="sauce-tile-label">overdue</span>
    </div>
    <div class="sauce-tile" class:is-warn={summary.today > 0}>
      <span class="sauce-tile-value">{summary.today}</span>
      <span class="sauce-tile-label">today</span>
    </div>
    <div class="sauce-tile">
      <span class="sauce-tile-value">{summary.upcoming}</span>
      <span class="sauce-tile-label">upcoming</span>
    </div>
    <div class="sauce-tile">
      <span class="sauce-tile-value">{summary.touches}</span>
      <span class="sauce-tile-label">touches</span>
    </div>
    <div class="sauce-tile">
      <span class="sauce-tile-value">{summary.followups}</span>
      <span class="sauce-tile-label">followups</span>
    </div>
  </header>

  <div class="sauce-inbox-controls">
    <div class="sauce-button-row" role="group" aria-label="Filter by kind">
      <button
        class="sauce-button-secondary"
        class:is-active={filterKind === "all"}
        aria-pressed={filterKind === "all"}
        onclick={() => (filterKind = "all")}>All</button
      >
      <button
        class="sauce-button-secondary"
        class:is-active={filterKind === "touch"}
        aria-pressed={filterKind === "touch"}
        onclick={() => (filterKind = "touch")}>Touches</button
      >
      <button
        class="sauce-button-secondary"
        class:is-active={filterKind === "followup"}
        aria-pressed={filterKind === "followup"}
        onclick={() => (filterKind = "followup")}>Followups</button
      >
    </div>
    <div class="sauce-field sauce-inbox-search">
      <label class="sauce-field-label" for="sauce-inbox-search">Search</label>
      <input
        id="sauce-inbox-search"
        class="sauce-input"
        type="text"
        placeholder="label or contact…"
        bind:value={search}
      />
    </div>
    <div class="sauce-field">
      <label class="sauce-field-label" for="sauce-inbox-contact">Contact</label>
      <select id="sauce-inbox-contact" class="sauce-input" bind:value={filterContact}>
        {#each contactOptions as c}<option value={c}>{c}</option>{/each}
      </select>
    </div>
  </div>

  {#snippet bucket(title: string, items: InboxRow[], cls: string)}
    {#if items.length > 0}
      <section class="sauce-section">
        <header class="sauce-section-header">
          <h4 class="sauce-bucket-head {cls}">
            {title}
            <span class="sauce-badge">{items.length}</span>
          </h4>
        </header>
        <ul class="sauce-inbox-list">
          {#each items as r (r.path)}
            <li class="sauce-inbox-row {cls}">
              <span
                class="sauce-cal-dot"
                style:background={KIND_COLOR[r.kind] ?? "var(--text-muted)"}
                title={r.kind}
              ></span>
              <button
                class="sauce-inbox-link"
                onclick={() => onOpenPath?.(r.path)}
                title="Open {r.label}">{r.label}</button
              >
              <span class="sauce-inbox-kind">{r.kind}</span>
              <span class="sauce-inbox-contact">{r.contact}</span>
              <span class="sauce-inbox-date">{r.date}</span>
              <span class="sauce-inbox-when">{whenLabel(r.daysFromToday)}</span>
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
    <p class="sauce-empty">
      {#if rows.length === 0}
        Inbox is empty — no touches or followups scheduled.
      {:else}
        Nothing matches the current filter.
      {/if}
    </p>
  {/if}
</div>

<style>
  .sauce-inbox {
    display: flex;
    flex-direction: column;
    gap: var(--size-4-2);
  }

  /* ── Summary tiles ──────────────────────────────────────────────────── */
  .sauce-inbox-summary {
    display: grid;
    grid-template-columns: repeat(5, 1fr);
    gap: var(--size-4-2);
  }
  @media (max-width: 600px) {
    .sauce-inbox-summary { grid-template-columns: repeat(2, 1fr); }
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

  /* ── Controls ───────────────────────────────────────────────────────── */
  .sauce-inbox-controls {
    display: grid;
    grid-template-columns: auto 1fr auto;
    gap: var(--size-4-2);
    align-items: end;
  }
  @media (max-width: 640px) {
    .sauce-inbox-controls { grid-template-columns: 1fr; }
  }
  .sauce-inbox-search { min-width: 0; }
  .sauce-button-row { display: flex; gap: var(--size-2-2); align-items: end; }
  .is-active {
    background: var(--interactive-accent);
    color: var(--text-on-accent);
    border-color: var(--interactive-accent);
  }

  /* ── Bucket headers ─────────────────────────────────────────────────── */
  .sauce-bucket-head {
    display: flex;
    align-items: center;
    gap: var(--size-2-2);
    margin: 0;
    padding-inline-start: var(--size-2-2);
    border-inline-start: 3px solid var(--text-muted);
  }
  .sauce-bucket-head.is-overdue { border-inline-start-color: var(--color-red); }
  .sauce-bucket-head.is-today { border-inline-start-color: var(--color-orange); }
  .sauce-bucket-head.is-upcoming { border-inline-start-color: var(--color-green); }

  /* ── Rows ───────────────────────────────────────────────────────────── */
  .sauce-inbox-list {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: var(--size-2-1);
  }
  .sauce-inbox-row {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto auto auto auto;
    gap: var(--size-4-2);
    align-items: center;
    padding: var(--size-2-2) var(--size-4-2);
    overflow-wrap: anywhere;
    background: var(--background-primary);
    border: 1px solid var(--background-modifier-border);
    border-radius: var(--radius-s);
    border-left: 3px solid transparent;
    transition: background 0.1s ease;
  }
  .sauce-inbox-row:hover { background: var(--background-modifier-hover); }
  .sauce-inbox-row.is-overdue { border-left-color: var(--color-red); }
  .sauce-inbox-row.is-today { border-left-color: var(--color-orange); }
  .sauce-inbox-row.is-upcoming { border-left-color: var(--color-green); }

  .sauce-cal-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    display: inline-block;
    flex: 0 0 auto;
  }
  .sauce-inbox-link {
    background: none;
    border: none;
    padding: 0;
    text-align: start;
    cursor: pointer;
    color: var(--text-normal);
    font: inherit;
    font-weight: var(--font-semibold);
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .sauce-inbox-link:hover { color: var(--interactive-accent); text-decoration: underline; }
  .sauce-inbox-link:focus-visible {
    outline: 2px solid var(--interactive-accent);
    outline-offset: 2px;
    border-radius: var(--radius-s);
  }
  .sauce-inbox-kind {
    font-size: var(--font-ui-smaller);
    text-transform: uppercase;
    letter-spacing: 0.03em;
    color: var(--text-muted);
  }
  .sauce-inbox-contact {
    font-size: var(--font-ui-smaller);
    color: var(--text-normal);
  }
  .sauce-inbox-contact::before { content: "@"; opacity: 0.6; }
  .sauce-inbox-date {
    font-size: var(--font-ui-smaller);
    color: var(--text-muted);
    font-variant-numeric: tabular-nums;
  }
  .sauce-inbox-when {
    font-size: var(--font-ui-smaller);
    color: var(--text-muted);
    text-align: end;
    white-space: nowrap;
  }
  .is-overdue .sauce-inbox-when { color: var(--color-red); font-weight: var(--font-semibold); }
  .is-today .sauce-inbox-when { color: var(--color-orange); font-weight: var(--font-semibold); }

  @media (max-width: 640px) {
    .sauce-inbox-row {
      grid-template-columns: auto minmax(0, 1fr) auto;
      grid-template-rows: auto auto;
      gap: 2px var(--size-2-2);
    }
    .sauce-inbox-when { grid-column: 3; grid-row: 1; }
    .sauce-inbox-kind { grid-column: 2; grid-row: 2; }
    .sauce-inbox-contact { grid-column: 2 / 4; grid-row: 2; justify-self: end; }
    .sauce-inbox-date { display: none; }
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
