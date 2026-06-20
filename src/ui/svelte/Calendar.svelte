<script lang="ts">
  // Sauce CRM Calendar — month / week / day / year views with time navigation.
  // Auto-scales to the host leaf (flex column; the grid flexes to fill height).
  import type { CalendarEvent } from "./CalendarTypes";

  interface Props {
    events: CalendarEvent[];
    onOpenPath?: (path: string) => void;
    onSelectDate?: (date: string) => void;
  }
  let { events, onOpenPath, onSelectDate }: Props = $props();

  type Mode = "month" | "week" | "day" | "year";

  // Focal date drives every view; selected date drives the detail list.
  let mode = $state<Mode>("month");
  let cursor = $state(new Date());
  let selectedDate = $state<string | null>(null);
  const MODES: Mode[] = ["month", "week", "day", "year"];

  const iso = (d: Date): string =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const TODAY = iso(new Date());

  const KIND_COLOR: Record<CalendarEvent["kind"], string> = {
    touch: "var(--color-blue)",
    task: "var(--color-orange)",
    followup: "var(--color-purple)",
    event: "var(--color-green)",
  };
  const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  let eventsByDate = $derived.by(() => {
    const map = new Map<string, CalendarEvent[]>();
    for (const ev of events) {
      const arr = map.get(ev.date) ?? [];
      arr.push(ev);
      map.set(ev.date, arr);
    }
    return map;
  });
  const evs = (d: string): CalendarEvent[] => eventsByDate.get(d) ?? [];

  // ── Month grid: 6 rows × 7 cols of Date|null ──────────────────────────
  let monthGrid = $derived.by((): Array<Date | null> => {
    const y = cursor.getFullYear();
    const m = cursor.getMonth();
    const start = new Date(y, m, 1).getDay();
    const last = new Date(y, m + 1, 0).getDate();
    const cells: Array<Date | null> = [];
    for (let i = 0; i < start; i++) cells.push(null);
    for (let d = 1; d <= last; d++) cells.push(new Date(y, m, d));
    while (cells.length < 42) cells.push(null);
    return cells;
  });

  // ── Week: the 7 days of cursor's week (Sun→Sat) ───────────────────────
  let weekDays = $derived.by((): Date[] => {
    const base = new Date(cursor);
    base.setDate(base.getDate() - base.getDay());
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(base);
      d.setDate(base.getDate() + i);
      return d;
    });
  });

  // ── Year: 12 months, each a compact day list ──────────────────────────
  let yearMonths = $derived.by(() =>
    Array.from({ length: 12 }, (_, m) => {
      const y = cursor.getFullYear();
      const start = new Date(y, m, 1).getDay();
      const last = new Date(y, m + 1, 0).getDate();
      const cells: Array<Date | null> = [];
      for (let i = 0; i < start; i++) cells.push(null);
      for (let d = 1; d <= last; d++) cells.push(new Date(y, m, d));
      while (cells.length % 7 !== 0) cells.push(null);
      return { label: new Date(y, m, 1).toLocaleString("default", { month: "short" }), cells };
    }),
  );

  let title = $derived.by(() => {
    if (mode === "year") return String(cursor.getFullYear());
    if (mode === "day")
      return cursor.toLocaleString("default", { weekday: "long", month: "long", day: "numeric", year: "numeric" });
    if (mode === "week") {
      const w = weekDays;
      return `${w[0].toLocaleString("default", { month: "short", day: "numeric" })} – ${w[6].toLocaleString("default", { month: "short", day: "numeric", year: "numeric" })}`;
    }
    return cursor.toLocaleString("default", { month: "long", year: "numeric" });
  });

  function nav(dir: number): void {
    const d = new Date(cursor);
    if (mode === "month") d.setMonth(d.getMonth() + dir);
    else if (mode === "week") d.setDate(d.getDate() + dir * 7);
    else if (mode === "day") d.setDate(d.getDate() + dir);
    else d.setFullYear(d.getFullYear() + dir);
    cursor = d;
  }
  function today(): void {
    cursor = new Date();
    selectDate(TODAY);
  }
  function selectDate(d: string): void {
    selectedDate = d;
    onSelectDate?.(d);
  }
  function openMonth(m: number): void {
    cursor = new Date(cursor.getFullYear(), m, 1);
    mode = "month";
  }
  const dayEvents = $derived(selectedDate ? evs(selectedDate) : []);

  const KINDS: CalendarEvent["kind"][] = ["touch", "task", "followup", "event"];
  let totalEvents = $derived(events.length);
</script>

<div class="sauce-cal">
  <header class="sauce-cal-head">
    <button class="sauce-cal-nav" onclick={() => nav(-1)} aria-label="previous">‹</button>
    <h3 class="sauce-cal-title">{title}</h3>
    <button class="sauce-cal-nav" onclick={() => nav(1)} aria-label="next">›</button>
    <div class="sauce-cal-modes" role="tablist">
      {#each MODES as m}
        <button class="sauce-cal-mode" class:is-active={mode === m} role="tab" aria-selected={mode === m} data-mode={m} onclick={() => (mode = m)}>{m}</button>
      {/each}
    </div>
    <button class="sauce-cal-today" onclick={today}>Today</button>
  </header>

  <div class="sauce-cal-legend" aria-label="Event kinds">
    {#each KINDS as k}
      <span class="sauce-cal-legend-item">
        <span class="sauce-cal-dot" style:background={KIND_COLOR[k]}></span>{k}
      </span>
    {/each}
    <span class="sauce-cal-legend-count">{totalEvents} event{totalEvents === 1 ? "" : "s"}</span>
  </div>

  {#if mode === "month" || mode === "week"}
    <div class="sauce-cal-weekdays">
      {#each WEEKDAYS as dow}<div class="sauce-cal-weekday">{dow}</div>{/each}
    </div>
  {/if}

  {#if mode === "month"}
    <div class="sauce-cal-grid sauce-cal-grid--month">
      {#each monthGrid as cell}
        {#if cell === null}
          <div class="sauce-cal-cell sauce-cal-cell--empty"></div>
        {:else}
          {@const d = iso(cell)}
          <button class="sauce-cal-cell" class:is-today={d === TODAY} class:is-selected={d === selectedDate} onclick={() => selectDate(d)} aria-label={d}>
            <span class="sauce-cal-cell-day">{cell.getDate()}</span>
            {#if evs(d).length > 0}
              <span class="sauce-cal-dots">
                {#each evs(d).slice(0, 4) as ev}<span class="sauce-cal-dot" style:background={KIND_COLOR[ev.kind]} title={ev.label}></span>{/each}
                {#if evs(d).length > 4}<span class="sauce-cal-dot-more">+{evs(d).length - 4}</span>{/if}
              </span>
            {/if}
          </button>
        {/if}
      {/each}
    </div>
  {:else if mode === "week"}
    <div class="sauce-cal-grid sauce-cal-grid--week">
      {#each weekDays as cell}
        {@const d = iso(cell)}
        <button class="sauce-cal-cell sauce-cal-cell--week" class:is-today={d === TODAY} class:is-selected={d === selectedDate} onclick={() => selectDate(d)} aria-label={d}>
          <span class="sauce-cal-cell-day">{cell.getDate()}</span>
          <span class="sauce-cal-week-events">
            {#each evs(d) as ev}
              <span class="sauce-cal-chip" style:border-inline-start-color={KIND_COLOR[ev.kind]} title={ev.label}>{ev.label}</span>
            {/each}
          </span>
        </button>
      {/each}
    </div>
  {:else if mode === "day"}
    {@const d = iso(cursor)}
    <div class="sauce-cal-grid sauce-cal-grid--day">
      {#if evs(d).length === 0}
        <p class="sauce-field-help">No items on this day.</p>
      {:else}
        <ul class="sauce-cal-list">
          {#each evs(d) as ev}
            <li class="sauce-cal-list-item">
              <span class="sauce-cal-dot" style:background={KIND_COLOR[ev.kind]}></span>
              <span class="sauce-cal-list-kind">{ev.kind}</span>
              {#if ev.path && onOpenPath}
                <button class="sauce-cal-list-link" onclick={() => onOpenPath?.(ev.path!)}>{ev.label}</button>
              {:else}<span>{ev.label}</span>{/if}
            </li>
          {/each}
        </ul>
      {/if}
    </div>
  {:else}
    <div class="sauce-cal-grid sauce-cal-grid--year">
      {#each yearMonths as ym, m}
        <button class="sauce-cal-mini" onclick={() => openMonth(m)}>
          <span class="sauce-cal-mini-label">{ym.label}</span>
          <span class="sauce-cal-mini-grid">
            {#each ym.cells as c}
              {#if c === null}<span class="sauce-cal-mini-cell"></span>
              {:else}{@const d = iso(c)}<span class="sauce-cal-mini-cell" class:is-today={d === TODAY} class:has-ev={evs(d).length > 0}>{c.getDate()}</span>{/if}
            {/each}
          </span>
        </button>
      {/each}
    </div>
  {/if}

  {#if selectedDate && mode !== "day" && mode !== "year"}
    <section class="sauce-cal-day-list">
      <header class="sauce-cal-day-head">
        <h4>{selectedDate}</h4><span class="sauce-field-help">{dayEvents.length} item(s)</span>
      </header>
      {#if dayEvents.length === 0}
        <p class="sauce-field-help">No items on this day.</p>
      {:else}
        <ul class="sauce-cal-list">
          {#each dayEvents as ev}
            <li class="sauce-cal-list-item">
              <span class="sauce-cal-dot" style:background={KIND_COLOR[ev.kind]}></span>
              <span class="sauce-cal-list-kind">{ev.kind}</span>
              {#if ev.path && onOpenPath}
                <button class="sauce-cal-list-link" onclick={() => onOpenPath?.(ev.path!)}>{ev.label}</button>
              {:else}<span>{ev.label}</span>{/if}
            </li>
          {/each}
        </ul>
      {/if}
    </section>
  {/if}
</div>

<style>
  .sauce-cal { display: flex; flex-direction: column; gap: var(--size-4-2); height: 100%; min-height: 0; box-sizing: border-box; }
  .sauce-cal-head { display: flex; align-items: center; gap: var(--size-4-2); flex-wrap: wrap; flex: 0 0 auto; }
  .sauce-cal-title { margin: 0; flex: 1 1 auto; font-size: var(--font-ui-large); }
  .sauce-cal-nav, .sauce-cal-today, .sauce-cal-mode {
    background: var(--interactive-normal); color: var(--text-normal); border: 1px solid var(--background-modifier-border);
    border-radius: var(--radius-s); padding: var(--size-2-1) var(--size-4-2); cursor: pointer; font: inherit; line-height: 1;
  }
  .sauce-cal-nav:hover, .sauce-cal-today:hover, .sauce-cal-mode:hover { background: var(--interactive-hover); }
  .sauce-cal-modes { display: flex; gap: 2px; }
  .sauce-cal-mode { text-transform: capitalize; font-size: var(--font-ui-smaller); }
  .sauce-cal-mode.is-active { background: var(--interactive-accent); color: var(--text-on-accent); border-color: var(--interactive-accent); }
  .sauce-cal-nav:focus-visible, .sauce-cal-today:focus-visible, .sauce-cal-mode:focus-visible, .sauce-cal-cell:focus-visible, .sauce-cal-mini:focus-visible, .sauce-cal-list-link:focus-visible {
    outline: 2px solid var(--interactive-accent); outline-offset: 2px;
  }

  .sauce-cal-legend { display: flex; flex-wrap: wrap; align-items: center; gap: var(--size-4-2); flex: 0 0 auto; font-size: var(--font-ui-smaller); color: var(--text-muted); }
  .sauce-cal-legend-item { display: inline-flex; align-items: center; gap: var(--size-2-1); text-transform: capitalize; }
  .sauce-cal-legend-count { margin-inline-start: auto; }

  .sauce-cal-weekdays { display: grid; grid-template-columns: repeat(7, 1fr); gap: 2px; flex: 0 0 auto; }
  .sauce-cal-weekday { text-align: center; font-size: var(--font-ui-smaller); color: var(--text-muted); padding: var(--size-2-1) 0; text-transform: uppercase; letter-spacing: 0.04em; }

  /* The grid flexes to fill all remaining leaf height — auto-scales. */
  .sauce-cal-grid { flex: 1 1 auto; min-height: 0; display: grid; gap: 2px; }
  .sauce-cal-grid--month { grid-template-columns: repeat(7, 1fr); grid-template-rows: repeat(6, minmax(0, 1fr)); }
  .sauce-cal-grid--week { grid-template-columns: repeat(7, 1fr); grid-template-rows: minmax(0, 1fr); }
  .sauce-cal-grid--day { display: block; overflow: auto; }
  .sauce-cal-grid--year { grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); grid-auto-rows: min-content; overflow: auto; }

  .sauce-cal-cell {
    display: flex; flex-direction: column; align-items: stretch; min-height: 0; overflow: hidden;
    padding: var(--size-2-2); background: var(--background-secondary); border: 1px solid var(--background-modifier-border);
    border-radius: var(--radius-s); cursor: pointer; font: inherit; color: inherit; text-align: start;
  }
  .sauce-cal-cell--empty { background: transparent; border-style: dashed; cursor: default; }
  .sauce-cal-cell:hover:not(.sauce-cal-cell--empty) { background: var(--background-modifier-hover); }
  .sauce-cal-cell.is-today { border-color: var(--interactive-accent); border-width: 2px; }
  .sauce-cal-cell.is-selected { background: var(--interactive-accent); color: var(--text-on-accent); }
  .sauce-cal-cell-day { font-size: var(--font-ui-small); font-weight: var(--font-semibold); flex: 0 0 auto; }
  .sauce-cal-dots { margin-block-start: auto; display: flex; flex-wrap: wrap; gap: 2px; align-items: center; }
  .sauce-cal-dot { width: 6px; height: 6px; border-radius: 50%; display: inline-block; background: var(--text-muted); flex: 0 0 auto; }
  .sauce-cal-dot-more { font-size: var(--font-ui-smaller); color: var(--text-muted); }

  .sauce-cal-cell--week { overflow: auto; }
  .sauce-cal-week-events { display: flex; flex-direction: column; gap: 2px; margin-block-start: var(--size-2-1); }
  .sauce-cal-chip { font-size: var(--font-ui-smaller); border-inline-start: 3px solid var(--text-muted); padding-inline-start: var(--size-2-2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

  .sauce-cal-mini { display: flex; flex-direction: column; gap: var(--size-2-1); background: var(--background-secondary); border: 1px solid var(--background-modifier-border); border-radius: var(--radius-s); padding: var(--size-4-1); cursor: pointer; color: inherit; font: inherit; }
  .sauce-cal-mini:hover { background: var(--background-modifier-hover); }
  .sauce-cal-mini-label { font-weight: var(--font-semibold); font-size: var(--font-ui-small); }
  .sauce-cal-mini-grid { display: grid; grid-template-columns: repeat(7, 1fr); gap: 1px; }
  .sauce-cal-mini-cell { text-align: center; font-size: 9px; color: var(--text-muted); aspect-ratio: 1; display: flex; align-items: center; justify-content: center; }
  .sauce-cal-mini-cell.has-ev { color: var(--text-normal); font-weight: var(--font-semibold); }
  .sauce-cal-mini-cell.is-today { background: var(--interactive-accent); color: var(--text-on-accent); border-radius: 50%; }

  .sauce-cal-day-list { flex: 0 0 auto; border-top: 1px solid var(--background-modifier-border); padding-block-start: var(--size-4-2); max-height: 30%; overflow: auto; }
  .sauce-cal-day-head { display: flex; align-items: baseline; justify-content: space-between; }
  .sauce-cal-day-head h4 { margin: 0; }
  .sauce-cal-list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: var(--size-2-2); }
  .sauce-cal-list-item { display: flex; align-items: center; gap: var(--size-2-2); }
  .sauce-cal-list-kind { font-size: var(--font-ui-smaller); text-transform: uppercase; color: var(--text-muted); min-width: 60px; }
  .sauce-cal-list-link { background: none; border: none; color: var(--text-accent); cursor: pointer; padding: 0; text-align: start; text-decoration: underline; font: inherit; }

  /* ===== Mobile calendar overrides (≤600px) ===== */
  @media (max-width: 600px) {
    /* Smaller cell height + font so month/week grids fit on a 360px screen. */
    .sauce-cal-cell { min-height: 38px; font-size: 0.8em; }
    /* Mode buttons wrap rather than overflow. */
    .sauce-cal-modes { flex-wrap: wrap; }
    /* Year view is too dense on a phone — hide the grid and its mode button. */
    .sauce-cal-grid--year { display: none; }
    .sauce-cal-mode[data-mode="year"] { display: none; }
  }

</style>
