<script lang="ts">
  // Ledger dashboard — summary tiles + per-contact / per-category rollups +
  // a sortable entries table. Net balance = in − out for each grouping key.
  // Svelte 5 runes.

  import type { LedgerRow, LedgerRollup } from "./DashboardTypes";

  interface Props {
    rows: LedgerRow[];
    onOpenPath?: (path: string) => void;
  }

  let { rows, onOpenPath }: Props = $props();

  let filterContact = $state("all");
  let filterCategory = $state("all");
  let filterDirection = $state<"all" | "in" | "out">("all");
  let rollupBy = $state<"contact" | "category">("contact");

  // Sortable entries table: column + direction. Clicking the active column
  // toggles direction; clicking a new column selects it (sensible default
  // direction per column).
  type SortCol = "date" | "contact" | "category" | "amount";
  let sortCol = $state<SortCol>("date");
  let sortDir = $state<"asc" | "desc">("desc");

  function setSort(col: SortCol): void {
    if (sortCol === col) {
      sortDir = sortDir === "asc" ? "desc" : "asc";
    } else {
      sortCol = col;
      // dates + amounts default to descending (newest / largest first);
      // text columns default to ascending (A→Z).
      sortDir = col === "date" || col === "amount" ? "desc" : "asc";
    }
  }

  let contacts = $derived([
    "all",
    ...[...new Set(rows.map((r) => r.contact))].sort((a, b) =>
      a.localeCompare(b),
    ),
  ]);
  let categories = $derived([
    "all",
    ...[...new Set(rows.map((r) => r.category))].sort((a, b) =>
      a.localeCompare(b),
    ),
  ]);

  let filtered = $derived(
    rows.filter((r) => {
      if (filterContact !== "all" && r.contact !== filterContact) return false;
      if (filterCategory !== "all" && r.category !== filterCategory) return false;
      if (filterDirection !== "all" && r.direction !== filterDirection)
        return false;
      return true;
    }),
  );

  // Dominant currency for the aggregate summary line. Amounts of mixed
  // currencies are summed numerically (we do not FX-convert); the symbol
  // shown is the most common currency in the filtered set.
  let dominantCurrency = $derived.by(() => {
    const counts = new Map<string, number>();
    for (const r of filtered) counts.set(r.currency, (counts.get(r.currency) ?? 0) + 1);
    let best = "USD";
    let bestN = -1;
    for (const [cur, n] of counts) if (n > bestN) { best = cur; bestN = n; }
    return best;
  });
  let mixedCurrency = $derived(new Set(filtered.map((r) => r.currency)).size > 1);

  let sorted = $derived.by(() => {
    const out = [...filtered];
    const dir = sortDir === "asc" ? 1 : -1;
    out.sort((a, b) => {
      let cmp = 0;
      if (sortCol === "amount") cmp = a.amount - b.amount;
      else if (sortCol === "date") cmp = a.date.localeCompare(b.date);
      else if (sortCol === "contact") cmp = a.contact.localeCompare(b.contact);
      else cmp = a.category.localeCompare(b.category);
      return cmp * dir;
    });
    return out;
  });

  let rollups = $derived.by((): LedgerRollup[] => {
    const map = new Map<string, LedgerRollup>();
    for (const r of filtered) {
      const key = rollupBy === "contact" ? r.contact : r.category;
      const cur =
        map.get(key) ?? { key, in: 0, out: 0, net: 0, entryCount: 0 };
      if (r.direction === "in") cur.in += r.amount;
      else cur.out += r.amount;
      cur.entryCount += 1;
      cur.net = cur.in - cur.out;
      map.set(key, cur);
    }
    return [...map.values()].sort((a, b) => Math.abs(b.net) - Math.abs(a.net));
  });

  let totals = $derived({
    in: filtered
      .filter((r) => r.direction === "in")
      .reduce((s, r) => s + r.amount, 0),
    out: filtered
      .filter((r) => r.direction === "out")
      .reduce((s, r) => s + r.amount, 0),
  });

  function fmt(n: number, currency: string = dominantCurrency): string {
    try {
      return new Intl.NumberFormat(undefined, {
        style: "currency",
        currency,
      }).format(n);
    } catch {
      return `${currency} ${n.toFixed(2)}`;
    }
  }

  const arrow = (col: SortCol): string =>
    sortCol === col ? (sortDir === "asc" ? " ▲" : " ▼") : "";
</script>

<div class="sauce-view sauce-ledger">
  <header class="sauce-ledger-summary" aria-label="Ledger summary">
    <div class="sauce-tile">
      <span class="sauce-tile-value">{filtered.length}</span>
      <span class="sauce-tile-label">entries</span>
    </div>
    <div class="sauce-tile is-in">
      <span class="sauce-tile-value">{fmt(totals.in)}</span>
      <span class="sauce-tile-label">in</span>
    </div>
    <div class="sauce-tile is-out">
      <span class="sauce-tile-value">{fmt(totals.out)}</span>
      <span class="sauce-tile-label">out</span>
    </div>
    <div
      class="sauce-tile"
      class:is-net-pos={totals.in - totals.out >= 0}
      class:is-net-neg={totals.in - totals.out < 0}
    >
      <span class="sauce-tile-value">{fmt(totals.in - totals.out)}</span>
      <span class="sauce-tile-label">net</span>
    </div>
  </header>
  {#if mixedCurrency}
    <p class="sauce-field-help sauce-ledger-note">
      Mixed currencies present — totals are summed numerically and shown in {dominantCurrency} (no FX conversion).
    </p>
  {/if}

  <div class="sauce-ledger-filters sauce-section">
    <div class="sauce-field">
      <label class="sauce-field-label" for="sauce-ledger-contact">Contact</label>
      <select id="sauce-ledger-contact" class="sauce-input" bind:value={filterContact}>
        {#each contacts as c}<option value={c}>{c}</option>{/each}
      </select>
    </div>
    <div class="sauce-field">
      <label class="sauce-field-label" for="sauce-ledger-category">Category</label>
      <select id="sauce-ledger-category" class="sauce-input" bind:value={filterCategory}>
        {#each categories as c}<option value={c}>{c}</option>{/each}
      </select>
    </div>
    <div class="sauce-field">
      <label class="sauce-field-label" for="sauce-ledger-direction">Direction</label>
      <select id="sauce-ledger-direction" class="sauce-input" bind:value={filterDirection}>
        <option value="all">all</option>
        <option value="in">in</option>
        <option value="out">out</option>
      </select>
    </div>
    <div class="sauce-field">
      <label class="sauce-field-label" for="sauce-ledger-rollup">Roll up by</label>
      <select id="sauce-ledger-rollup" class="sauce-input" bind:value={rollupBy}>
        <option value="contact">contact</option>
        <option value="category">category</option>
      </select>
    </div>
  </div>

  {#if rollups.length > 0}
    <section class="sauce-section">
      <header class="sauce-section-header">
        <h4>Rollup by {rollupBy}</h4>
      </header>
      <div class="sauce-table-wrap">
        <table class="sauce-table sauce-ledger-table">
          <thead>
            <tr>
              <th>{rollupBy === "contact" ? "Contact" : "Category"}</th>
              <th class="num">In</th>
              <th class="num">Out</th>
              <th class="num">Net</th>
              <th class="num">Entries</th>
            </tr>
          </thead>
          <tbody>
            {#each rollups as r (r.key)}
              <tr>
                <td>{r.key}</td>
                <td class="num">{fmt(r.in)}</td>
                <td class="num">{fmt(r.out)}</td>
                <td class="num {r.net >= 0 ? 'sauce-net-pos' : 'sauce-net-neg'}">{fmt(r.net)}</td>
                <td class="num">{r.entryCount}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    </section>
  {/if}

  <section class="sauce-section">
    <header class="sauce-section-header"><h4>Entries</h4></header>
    {#if sorted.length === 0}
      <p class="sauce-empty">
        {#if rows.length === 0}
          No ledger entries in the vault yet.
        {:else}
          No entries match the current filters.
        {/if}
      </p>
    {:else}
      <div class="sauce-table-wrap">
        <table class="sauce-table sauce-ledger-table">
          <thead>
            <tr>
              <th>
                <button class="sauce-th-sort" aria-label="Sort by date" onclick={() => setSort("date")}>Date{arrow("date")}</button>
              </th>
              <th>
                <button class="sauce-th-sort" aria-label="Sort by contact" onclick={() => setSort("contact")}>Contact{arrow("contact")}</button>
              </th>
              <th>
                <button class="sauce-th-sort" aria-label="Sort by category" onclick={() => setSort("category")}>Category{arrow("category")}</button>
              </th>
              <th>Dir</th>
              <th class="num">
                <button class="sauce-th-sort num" aria-label="Sort by amount" onclick={() => setSort("amount")}>Amount{arrow("amount")}</button>
              </th>
              <th>Notes</th>
            </tr>
          </thead>
          <tbody>
            {#each sorted as r (r.path)}
              <tr>
                <td class="num">{r.date}</td>
                <td>
                  <button class="sauce-ledger-link" onclick={() => onOpenPath?.(r.path)} title="Open entry">{r.contact}</button>
                </td>
                <td>{r.category}</td>
                <td>
                  <span class="sauce-dir sauce-dir--{r.direction}">{r.direction}</span>
                </td>
                <td class="num">{fmt(r.amount, r.currency)}</td>
                <td class="sauce-ledger-notes">{r.notes ?? ""}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}
  </section>
</div>

<style>
  .sauce-ledger {
    display: flex;
    flex-direction: column;
    gap: var(--size-4-2);
  }

  /* ── Summary tiles ──────────────────────────────────────────────────── */
  .sauce-ledger-summary {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: var(--size-4-2);
  }
  @media (max-width: 600px) {
    .sauce-ledger-summary { grid-template-columns: repeat(2, 1fr); }
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
  .sauce-tile-value {
    font-size: var(--font-ui-medium);
    font-weight: 700;
    line-height: 1.2;
    color: var(--text-normal);
    font-variant-numeric: tabular-nums;
  }
  .sauce-tile-label {
    font-size: var(--font-ui-smaller);
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .sauce-tile.is-in .sauce-tile-value { color: var(--color-green); }
  .sauce-tile.is-out .sauce-tile-value { color: var(--color-red); }
  .sauce-tile.is-net-pos .sauce-tile-value { color: var(--color-green); }
  .sauce-tile.is-net-neg .sauce-tile-value { color: var(--color-red); }
  .sauce-ledger-note { margin: 0; }

  /* ── Filters ────────────────────────────────────────────────────────── */
  .sauce-ledger-filters {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: var(--size-4-2);
  }
  @media (max-width: 700px) { .sauce-ledger-filters { grid-template-columns: 1fr 1fr; } }
  @media (max-width: 420px) { .sauce-ledger-filters { grid-template-columns: 1fr; } }

  /* ── Tables ─────────────────────────────────────────────────────────── */
  .sauce-ledger-table { width: 100%; }
  .sauce-ledger-table th,
  .sauce-ledger-table td {
    padding: var(--size-2-2) var(--size-4-2);
    text-align: start;
    border-bottom: 1px solid var(--background-modifier-border);
    vertical-align: top;
  }
  .sauce-ledger-table thead th {
    color: var(--text-muted);
    font-size: var(--font-ui-smaller);
    text-transform: uppercase;
    letter-spacing: 0.03em;
    position: sticky;
    top: 0;
    background: var(--background-secondary);
    z-index: 1;
  }
  .sauce-ledger-table tbody tr:hover { background: var(--background-modifier-hover); }
  .sauce-ledger-table .num {
    text-align: end;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  .sauce-net-pos { color: var(--color-green); font-weight: var(--font-semibold); }
  .sauce-net-neg { color: var(--color-red); font-weight: var(--font-semibold); }

  .sauce-th-sort {
    background: none;
    border: none;
    padding: 0;
    margin: 0;
    cursor: pointer;
    color: inherit;
    font: inherit;
    text-transform: inherit;
    letter-spacing: inherit;
  }
  .sauce-th-sort.num { width: 100%; text-align: end; }
  .sauce-th-sort:hover { color: var(--text-normal); }
  .sauce-th-sort:focus-visible {
    outline: 2px solid var(--interactive-accent);
    outline-offset: 2px;
    border-radius: var(--radius-s);
  }

  .sauce-ledger-link {
    background: none;
    border: none;
    padding: 0;
    text-align: start;
    cursor: pointer;
    color: var(--text-normal);
    font: inherit;
    font-weight: var(--font-semibold);
  }
  .sauce-ledger-link:hover { color: var(--interactive-accent); text-decoration: underline; }
  .sauce-ledger-link:focus-visible {
    outline: 2px solid var(--interactive-accent);
    outline-offset: 2px;
    border-radius: var(--radius-s);
  }

  .sauce-dir {
    display: inline-block;
    font-size: var(--font-ui-smaller);
    text-transform: uppercase;
    letter-spacing: 0.03em;
    padding: 1px var(--size-2-2);
    border-radius: var(--radius-s);
    border: 1px solid currentColor;
  }
  .sauce-dir--in { color: var(--color-green); }
  .sauce-dir--out { color: var(--color-red); }

  .sauce-ledger-notes {
    color: var(--text-muted);
    font-size: var(--font-ui-smaller);
    overflow-wrap: anywhere;
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
