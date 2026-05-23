<script lang="ts">
  // Sauce CRM Calendar — a month grid with touch / task / followup dots
  // rendered per date. Operator clicks a date to see the day's items
  // listed below. Mobile-responsive via Fibonacci CSS tokens.
  import type { CalendarEvent } from "./CalendarTypes";

  interface Props {
    events: CalendarEvent[];
    /** Callback when the operator clicks an event's link. */
    onOpenPath?: (path: string) => void;
    /** Callback when a date cell is selected. */
    onSelectDate?: (date: string) => void;
  }

  let { events, onOpenPath, onSelectDate }: Props = $props();

  // Reactive state: the displayed month + selected date.
  let displayMonth = $state(new Date().toISOString().slice(0, 7));
  let selectedDate = $state<string | null>(null);

  // Derived: parse the month into year/month-index.
  let [year, monthIdx] = $derived.by(() => {
    const [y, m] = displayMonth.split("-").map(Number);
    return [y, m - 1] as const;
  }) as unknown as readonly [number, number];

  // Derived: index events by date for quick lookup.
  let eventsByDate = $derived.by(() => {
    const map = new Map<string, CalendarEvent[]>();
    for (const ev of events) {
      const arr = map.get(ev.date) ?? [];
      arr.push(ev);
      map.set(ev.date, arr);
    }
    return map;
  });

  // Build the 6-row × 7-col grid for the displayed month.
  // Each cell is either a date string (YYYY-MM-DD) or null (empty cell).
  let grid = $derived.by((): Array<string | null> => {
    const firstOfMonth = new Date(year, monthIdx, 1);
    const startDayOfWeek = firstOfMonth.getDay(); // 0 = Sunday
    const lastOfMonth = new Date(year, monthIdx + 1, 0).getDate();
    const cells: Array<string | null> = [];
    for (let i = 0; i < startDayOfWeek; i++) cells.push(null);
    for (let d = 1; d <= lastOfMonth; d++) {
      const iso = `${year}-${String(monthIdx + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      cells.push(iso);
    }
    while (cells.length % 7 !== 0) cells.push(null);
    while (cells.length < 42) cells.push(null);
    return cells;
  });

  let monthLabel = $derived.by(() => {
    return new Date(year, monthIdx, 1).toLocaleString("default", {
      month: "long",
      year: "numeric",
    });
  });

  function gotoMonth(delta: number): void {
    const d = new Date(year, monthIdx + delta, 1);
    displayMonth = d.toISOString().slice(0, 7);
  }

  function selectDate(iso: string): void {
    selectedDate = iso;
    onSelectDate?.(iso);
  }

  function eventsForSelected(): CalendarEvent[] {
    if (!selectedDate) return [];
    return eventsByDate.get(selectedDate) ?? [];
  }

  const TODAY = new Date().toISOString().slice(0, 10);
  const KIND_COLOR: Record<CalendarEvent["kind"], string> = {
    touch:    "var(--color-blue)",
    task:     "var(--color-orange)",
    followup: "var(--color-purple)",
    event:    "var(--color-green)",
  };
</script>

<div class="sauce-cal">
  <header class="sauce-cal-head">
    <button class="sauce-button-secondary" onclick={() => gotoMonth(-1)} aria-label="previous month">‹</button>
    <h3 class="sauce-cal-title">{monthLabel}</h3>
    <button class="sauce-button-secondary" onclick={() => gotoMonth(1)} aria-label="next month">›</button>
    <button
      class="sauce-button-secondary sauce-cal-today"
      onclick={() => { displayMonth = TODAY.slice(0, 7); selectDate(TODAY); }}
    >Today</button>
  </header>

  <div class="sauce-cal-weekdays">
    {#each ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"] as dow}
      <div class="sauce-cal-weekday">{dow}</div>
    {/each}
  </div>

  <div class="sauce-cal-grid">
    {#each grid as cell}
      {#if cell === null}
        <div class="sauce-cal-cell sauce-cal-cell--empty"></div>
      {:else}
        {@const evs = eventsByDate.get(cell) ?? []}
        {@const isToday = cell === TODAY}
        {@const isSelected = cell === selectedDate}
        <button
          class="sauce-cal-cell"
          class:is-today={isToday}
          class:is-selected={isSelected}
          onclick={() => selectDate(cell)}
          aria-label={cell}
        >
          <span class="sauce-cal-cell-day">{Number(cell.slice(-2))}</span>
          {#if evs.length > 0}
            <span class="sauce-cal-dots" aria-label={`${evs.length} items`}>
              {#each evs.slice(0, 4) as ev}
                <span class="sauce-cal-dot" style:background={KIND_COLOR[ev.kind]} title={ev.label}></span>
              {/each}
              {#if evs.length > 4}
                <span class="sauce-cal-dot-more">+{evs.length - 4}</span>
              {/if}
            </span>
          {/if}
        </button>
      {/if}
    {/each}
  </div>

  {#if selectedDate}
    <section class="sauce-cal-day-list sauce-section">
      <header class="sauce-section-header">
        <h4 style="margin:0">{selectedDate}</h4>
        <span class="sauce-field-help">{eventsForSelected().length} item(s)</span>
      </header>
      {#if eventsForSelected().length === 0}
        <p class="sauce-field-help">No items on this day.</p>
      {:else}
        <ul class="sauce-cal-list">
          {#each eventsForSelected() as ev}
            <li class="sauce-cal-list-item">
              <span class="sauce-cal-dot" style:background={KIND_COLOR[ev.kind]}></span>
              <span class="sauce-cal-list-kind">{ev.kind}</span>
              {#if ev.path && onOpenPath}
                <button class="sauce-cal-list-link" onclick={() => onOpenPath?.(ev.path!)}>
                  {ev.label}
                </button>
              {:else}
                <span>{ev.label}</span>
              {/if}
            </li>
          {/each}
        </ul>
      {/if}
    </section>
  {/if}
</div>

<style>
  .sauce-cal {
    display: flex;
    flex-direction: column;
    gap: var(--sg-gap-8, 8px);
    padding: var(--sg-gap-13, 13px);
    height: 100%;
    box-sizing: border-box;
  }
  .sauce-cal-head {
    display: flex;
    align-items: center;
    gap: var(--sg-gap-8, 8px);
    flex-wrap: wrap;
  }
  .sauce-cal-title {
    margin: 0;
    flex: 1 1 auto;
    font-size: 1.1em;
  }
  .sauce-cal-today {
    margin-inline-start: auto;
  }
  .sauce-cal-weekdays {
    display: grid;
    grid-template-columns: repeat(7, 1fr);
    gap: var(--sg-gap-2, 2px);
  }
  .sauce-cal-weekday {
    text-align: center;
    font-size: 0.75em;
    color: var(--text-muted);
    padding: var(--sg-gap-3, 3px) 0;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .sauce-cal-grid {
    display: grid;
    grid-template-columns: repeat(7, 1fr);
    gap: var(--sg-gap-2, 2px);
  }
  .sauce-cal-cell {
    aspect-ratio: 1 / 1;
    display: flex;
    flex-direction: column;
    align-items: stretch;
    justify-content: flex-start;
    padding: var(--sg-gap-3, 3px);
    background: var(--background-secondary);
    border: 1px solid var(--background-modifier-border);
    border-radius: var(--sg-radius-sm, 4px);
    cursor: pointer;
    font: inherit;
    color: inherit;
    text-align: start;
    overflow-wrap: anywhere;
  }
  .sauce-cal-cell--empty {
    background: transparent;
    border: 1px dashed var(--background-modifier-border);
    cursor: default;
  }
  .sauce-cal-cell:hover:not(.sauce-cal-cell--empty) {
    background: var(--background-modifier-hover);
  }
  .sauce-cal-cell.is-today {
    border-color: var(--interactive-accent);
    border-width: 2px;
  }
  .sauce-cal-cell.is-selected {
    background: var(--interactive-accent);
    color: var(--text-on-accent);
  }
  .sauce-cal-cell-day {
    font-size: 0.85em;
    font-weight: 600;
  }
  .sauce-cal-dots {
    margin-block-start: auto;
    display: flex;
    flex-wrap: wrap;
    gap: 2px;
    align-items: center;
  }
  .sauce-cal-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    display: inline-block;
    background: var(--text-muted);
  }
  .sauce-cal-dot-more {
    font-size: 0.7em;
    color: var(--text-muted);
  }
  .sauce-cal-day-list {
    margin-block-start: var(--sg-gap-8, 8px);
  }
  .sauce-cal-list {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: var(--sg-gap-5, 5px);
  }
  .sauce-cal-list-item {
    display: flex;
    align-items: center;
    gap: var(--sg-gap-5, 5px);
    overflow-wrap: anywhere;
  }
  .sauce-cal-list-kind {
    font-size: 0.75em;
    text-transform: uppercase;
    color: var(--text-muted);
    min-width: 60px;
  }
  .sauce-cal-list-link {
    background: none;
    border: none;
    color: var(--interactive-accent);
    cursor: pointer;
    padding: 0;
    text-align: start;
    text-decoration: underline;
    font: inherit;
  }
  .sauce-cal-list-link:hover { color: var(--interactive-accent-hover); }

  @media (max-width: 480px) {
    .sauce-cal-cell { padding: 1px; }
    .sauce-cal-cell-day { font-size: 0.75em; }
    .sauce-cal-dot { width: 4px; height: 4px; }
  }
</style>
