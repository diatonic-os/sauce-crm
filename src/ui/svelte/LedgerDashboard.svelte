<script lang="ts">
  // Ledger dashboard — entries table + per-contact rollups. Net balance
  // computed as in-out per contact; positive = operator owes, negative
  // = contact owes operator (depending on category convention).

  import type { LedgerRow, LedgerRollup } from "./DashboardTypes";

  interface Props {
    rows: LedgerRow[];
    onOpenPath?: (path: string) => void;
  }

  let { rows, onOpenPath }: Props = $props();

  let filterContact = $state("all");
  let filterDirection = $state<"all" | "in" | "out">("all");
  let sortBy = $state<"date" | "amount" | "contact">("date");

  let contacts = $derived(["all", ...new Set(rows.map((r) => r.contact))].sort());

  let filtered = $derived(rows.filter((r) => {
    if (filterContact !== "all" && r.contact !== filterContact) return false;
    if (filterDirection !== "all" && r.direction !== filterDirection) return false;
    return true;
  }));

  let sorted = $derived.by(() => {
    const out = [...filtered];
    if (sortBy === "date") out.sort((a, b) => b.date.localeCompare(a.date));
    else if (sortBy === "amount") out.sort((a, b) => b.amount - a.amount);
    else out.sort((a, b) => a.contact.localeCompare(b.contact));
    return out;
  });

  let rollups = $derived.by((): LedgerRollup[] => {
    const map = new Map<string, LedgerRollup>();
    for (const r of filtered) {
      const cur = map.get(r.contact) ?? { contact: r.contact, in: 0, out: 0, net: 0, entryCount: 0 };
      if (r.direction === "in") cur.in += r.amount;
      else cur.out += r.amount;
      cur.entryCount += 1;
      cur.net = cur.in - cur.out;
      map.set(r.contact, cur);
    }
    return [...map.values()].sort((a, b) => Math.abs(b.net) - Math.abs(a.net));
  });

  let totals = $derived({
    in:  filtered.filter((r) => r.direction === "in").reduce((s, r) => s + r.amount, 0),
    out: filtered.filter((r) => r.direction === "out").reduce((s, r) => s + r.amount, 0),
  });

  function fmt(n: number, currency: string = "USD"): string {
    try {
      return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(n);
    } catch {
      return `${currency} ${n.toFixed(2)}`;
    }
  }
</script>

<div class="sauce-view sauce-ledger">
  <header class="sauce-section-header">
    <h3>Ledger</h3>
    <span class="sauce-field-help">
      {filtered.length} entries · in {fmt(totals.in)} · out {fmt(totals.out)} · net {fmt(totals.in - totals.out)}
    </span>
  </header>

  <div class="sauce-ledger-filters sauce-section">
    <div class="sauce-field">
      <label class="sauce-field-label" for="sauce-ledger-contact">Contact</label>
      <select id="sauce-ledger-contact" class="sauce-input" bind:value={filterContact}>
        {#each contacts as c}<option value={c}>{c}</option>{/each}
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
      <label class="sauce-field-label" for="sauce-ledger-sort">Sort by</label>
      <select id="sauce-ledger-sort" class="sauce-input" bind:value={sortBy}>
        <option value="date">date (newest first)</option>
        <option value="amount">amount (largest first)</option>
        <option value="contact">contact (A→Z)</option>
      </select>
    </div>
  </div>

  {#if rollups.length > 0}
    <section class="sauce-section">
      <header class="sauce-section-header"><h4>Per-contact rollups</h4></header>
      <div class="sauce-table-wrap">
        <table class="sauce-table">
          <thead><tr><th>Contact</th><th>In</th><th>Out</th><th>Net</th><th>Entries</th></tr></thead>
          <tbody>
            {#each rollups as r}
              <tr>
                <td>{r.contact}</td>
                <td>{fmt(r.in)}</td>
                <td>{fmt(r.out)}</td>
                <td class={r.net >= 0 ? "sauce-net-pos" : "sauce-net-neg"}>{fmt(r.net)}</td>
                <td>{r.entryCount}</td>
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
      <p class="sauce-field-help">No entries match the current filters.</p>
    {:else}
      <div class="sauce-table-wrap">
        <table class="sauce-table">
          <thead><tr><th>Date</th><th>Contact</th><th>Category</th><th>Dir</th><th>Amount</th><th>Notes</th></tr></thead>
          <tbody>
            {#each sorted as r}
              <tr>
                <td>{r.date}</td>
                <td>
                  <button class="sauce-cal-list-link" onclick={() => onOpenPath?.(r.path)}>{r.contact}</button>
                </td>
                <td>{r.category}</td>
                <td><span class="sauce-badge" class:sauce-badge--ok={r.direction === "in"} class:sauce-badge--warn={r.direction === "out"}>{r.direction}</span></td>
                <td>{fmt(r.amount, r.currency)}</td>
                <td>{r.notes ?? ""}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}
  </section>
</div>

<style>
  .sauce-ledger-filters {
    display: grid;
    grid-template-columns: 2fr 1fr 1fr;
    gap: var(--sg-gap-8, 8px);
  }
  @media (max-width: 600px) { .sauce-ledger-filters { grid-template-columns: 1fr; } }
  .sauce-net-pos { color: var(--color-green); font-weight: 600; }
  .sauce-net-neg { color: var(--color-red); font-weight: 600; }
</style>
