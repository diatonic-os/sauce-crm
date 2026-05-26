# Sauce Cloud — Subsystem 1: Supabase Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Also run the `supabase:supabase-postgres-best-practices` skill when authoring/reviewing the SQL.

**Goal:** Stand up the Sauce Cloud control-plane data layer — schema, RLS, and the atomic credit RPCs (`reserve → commit / release`, idempotent monthly grant) that make strict paywalls correct under concurrency.

**Architecture:** A new, standalone `sauce-cloud/` workspace holding a Supabase project (Postgres migrations + seed). All money tables are written **only** via `SECURITY DEFINER` Postgres functions; clients get RLS-scoped read-only access. The reserve uses a single guarded atomic `UPDATE` so concurrent requests can never overspend, and reserve/commit are two **separate short transactions** (no DB lock is held across the gateway's upstream LLM call).

**Tech Stack:** Supabase CLI (local Postgres 15 via `supabase start`), SQL migrations, `vitest` + `@supabase/supabase-js` for tests (RLS via anon/JWT roles, RPCs via `.rpc()`), run against the local stack.

**Spec:** `docs/superpowers/specs/2026-05-25-sauce-cloud-mvp-design.md` §3 (data model), §4 (lifecycle), §7 (security), §8 (testing). This plan implements §10 step 1 only; billing/gateway/client/deploy are separate plans.

**Conventions:** lowercase snake_case identifiers; every FK + RLS column indexed; constraints in-migration; credits stored as **bigint µ-credits** (1 credit = 1,000,000 µ); `SECURITY DEFINER` functions set `search_path = ''` and schema-qualify everything; small commits per task.

---

### Task 0: Scaffold the `sauce-cloud/` workspace

**Files:**
- Create: `sauce-cloud/.gitignore`
- Create: `sauce-cloud/package.json`
- Create: `sauce-cloud/vitest.config.ts`
- Create: `sauce-cloud/supabase/config.toml` (via `supabase init`)
- Create: `sauce-cloud/README.md`

- [ ] **Step 1: Create the workspace + init Supabase**

```bash
mkdir -p sauce-cloud && cd sauce-cloud
npx --yes supabase@latest init      # creates supabase/config.toml + migrations dir
```

- [ ] **Step 2: Write `sauce-cloud/package.json`**

```json
{
  "name": "sauce-cloud",
  "private": true,
  "type": "module",
  "scripts": {
    "db:start": "supabase start",
    "db:stop": "supabase stop",
    "db:reset": "supabase db reset",
    "test": "vitest run"
  },
  "devDependencies": {
    "@supabase/supabase-js": "^2.45.0",
    "supabase": "^1.200.0",
    "vitest": "^4.1.7"
  }
}
```

- [ ] **Step 3: Write `sauce-cloud/.gitignore`**

```
node_modules/
supabase/.branches/
supabase/.temp/
.env
*.log
```

- [ ] **Step 4: Write `sauce-cloud/vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";
export default defineConfig({
  test: { environment: "node", include: ["test/**/*.test.ts"], testTimeout: 30_000, pool: "forks", singleFork: true },
});
```

- [ ] **Step 5: Write `sauce-cloud/README.md`** (one paragraph: "Sauce Cloud control plane. `npm i && npm run db:start` then `npm test`. Migrations in `supabase/migrations/`, seed in `supabase/seed.sql`.")

- [ ] **Step 6: Install + verify the local stack boots**

Run: `cd sauce-cloud && npm install && npm run db:start`
Expected: Supabase prints local API URL + anon/service keys (note them for tests). `npm run db:stop` to halt.

- [ ] **Step 7: Commit**

```bash
git add sauce-cloud/.gitignore sauce-cloud/package.json sauce-cloud/vitest.config.ts sauce-cloud/supabase/config.toml sauce-cloud/README.md
git commit -m "chore(sauce-cloud): scaffold Supabase workspace + vitest harness"
```

---

### Task 1: Identity & plans schema

**Files:**
- Create: `sauce-cloud/supabase/migrations/0001_identity_plans.sql`

- [ ] **Step 1: Write the migration**

```sql
-- 0001_identity_plans.sql — accounts, installs, plans, model_catalog.
create table public.accounts (
  id                 uuid primary key references auth.users (id) on delete cascade,
  stripe_customer_id text unique,
  plan_id            text not null default 'free',
  status             text not null default 'active'
                       check (status in ('active','past_due','canceled')),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create table public.plans (
  id             text primary key,                 -- 'free' | 'plus' | 'pro'
  name           text not null,
  monthly_credits bigint not null default 0,       -- µ-credits
  price_cents    integer not null default 0,
  stripe_price_id text,
  tier_rank      integer not null,                 -- entitlement ordering
  features       jsonb not null default '{}'::jsonb,
  created_at     timestamptz not null default now()
);

create table public.installs (
  id             uuid primary key default gen_random_uuid(),
  account_id     uuid references public.accounts (id) on delete set null,
  platform       text,
  plugin_version text,
  created_at     timestamptz not null default now(),
  last_seen_at   timestamptz not null default now()
);
create index installs_account_id_idx on public.installs (account_id);

create table public.model_catalog (
  id                  text primary key,            -- 'anthropic/claude-opus-4-7'
  provider            text not null,               -- 'anthropic' | 'openai' | ...
  display_name        text not null,
  credit_per_1k_input  bigint not null,            -- µ-credits per 1k input tokens
  credit_per_1k_output bigint not null,
  min_tier_rank       integer not null default 0,
  enabled             boolean not null default true
);

-- accounts.plan_id must reference a real plan (added after plans exists).
alter table public.accounts
  add constraint accounts_plan_fk foreign key (plan_id) references public.plans (id);
create index accounts_plan_id_idx on public.accounts (plan_id);
```

- [ ] **Step 2: Apply + verify**

Run: `cd sauce-cloud && npm run db:reset`
Expected: reset succeeds, migration `0001` applied with no error.

- [ ] **Step 3: Commit**

```bash
git add sauce-cloud/supabase/migrations/0001_identity_plans.sql
git commit -m "feat(sauce-cloud): identity + plans + model_catalog schema"
```

---

### Task 2: Billing mirror + credits schema

**Files:**
- Create: `sauce-cloud/supabase/migrations/0002_billing_credits.sql`

- [ ] **Step 1: Write the migration**

```sql
-- 0002_billing_credits.sql — subscriptions, webhook idempotency, credit ledger.
create table public.subscriptions (
  id                   text primary key,           -- stripe subscription id
  account_id           uuid not null references public.accounts (id) on delete cascade,
  plan_id              text not null references public.plans (id),
  status               text not null,              -- stripe status verbatim
  current_period_start timestamptz,
  current_period_end   timestamptz,
  cancel_at_period_end boolean not null default false,
  updated_at           timestamptz not null default now()
);
create index subscriptions_account_id_idx on public.subscriptions (account_id);

create table public.webhook_events (
  stripe_event_id text primary key,
  type            text not null,
  processed_at    timestamptz not null default now()
);

-- Append-only ledger. balance = sum(amount). Never UPDATE/DELETE rows.
create table public.credit_ledger (
  id              bigint generated always as identity primary key,
  account_id      uuid not null references public.accounts (id) on delete cascade,
  ts              timestamptz not null default now(),
  kind            text not null check (kind in ('grant','reserve','commit','release','adjustment')),
  amount          bigint not null,                 -- signed µ-credits
  reason          text,
  ref             text,                            -- usage_event id / invoice id / reservation id
  idempotency_key text unique                      -- nulls allowed; unique when set
);
create index credit_ledger_account_ts_idx on public.credit_ledger (account_id, ts desc);

-- Fast-check cache, updated in the SAME txn as ledger writes.
create table public.credit_balances (
  account_id uuid primary key references public.accounts (id) on delete cascade,
  balance    bigint not null default 0,            -- µ-credits; never negative except settled overage
  updated_at timestamptz not null default now()
);

create table public.usage_events (
  id               uuid primary key default gen_random_uuid(),
  account_id       uuid not null references public.accounts (id) on delete cascade,
  install_id       uuid references public.installs (id) on delete set null,
  ts               timestamptz not null default now(),
  model_id         text not null,
  input_tokens     integer not null default 0,
  output_tokens    integer not null default 0,
  credits_charged  bigint not null default 0,      -- µ-credits
  request_id       text,
  status           text not null check (status in ('ok','error','paywalled')),
  latency_ms       integer,
  upstream_provider text
);
create index usage_events_account_ts_idx on public.usage_events (account_id, ts desc);
```

- [ ] **Step 2: Apply + verify**

Run: `cd sauce-cloud && npm run db:reset`
Expected: migrations `0001`+`0002` apply cleanly.

- [ ] **Step 3: Commit**

```bash
git add sauce-cloud/supabase/migrations/0002_billing_credits.sql
git commit -m "feat(sauce-cloud): billing mirror + append-only credit ledger schema"
```

---

### Task 3: RLS policies + least-privilege grants

**Files:**
- Create: `sauce-cloud/supabase/migrations/0003_rls.sql`

- [ ] **Step 1: Write the migration**

```sql
-- 0003_rls.sql — enable + force RLS; users read only their own rows; public
-- read for plans/model_catalog; NO client writes to money tables.
revoke all on schema public from public;

-- Per-account read-only tables.
do $$
declare t text;
begin
  foreach t in array array['accounts','subscriptions','credit_ledger','credit_balances','usage_events']
  loop
    execute format('alter table public.%I enable row level security;', t);
    execute format('alter table public.%I force row level security;', t);
  end loop;
end $$;

-- accounts: a user sees their own row (id = auth.uid()).
create policy accounts_self_read on public.accounts
  for select to authenticated using ((select auth.uid()) = id);

-- account-scoped tables: account_id = auth.uid().
create policy subs_self_read on public.subscriptions
  for select to authenticated using ((select auth.uid()) = account_id);
create policy ledger_self_read on public.credit_ledger
  for select to authenticated using ((select auth.uid()) = account_id);
create policy balances_self_read on public.credit_balances
  for select to authenticated using ((select auth.uid()) = account_id);
create policy usage_self_read on public.usage_events
  for select to authenticated using ((select auth.uid()) = account_id);

-- plans + model_catalog: public read (plugin shows pricing/models), no writes.
alter table public.plans enable row level security;
alter table public.model_catalog enable row level security;
create policy plans_public_read on public.plans for select to anon, authenticated using (true);
create policy models_public_read on public.model_catalog for select to anon, authenticated using (true);

-- installs: an install upserts its own row (id-scoped); reads its own.
alter table public.installs enable row level security;
alter table public.installs force row level security;
create policy installs_insert on public.installs
  for insert to anon, authenticated with check (true);
create policy installs_self_rw on public.installs
  for update to authenticated using ((select auth.uid()) = account_id)
  with check ((select auth.uid()) = account_id);

-- Read grants for the authenticated role (RLS still filters rows).
grant usage on schema public to anon, authenticated;
grant select on public.plans, public.model_catalog to anon, authenticated;
grant select on public.accounts, public.subscriptions, public.credit_ledger,
  public.credit_balances, public.usage_events to authenticated;
grant insert, update on public.installs to anon, authenticated;
```

- [ ] **Step 2: Apply + verify**

Run: `cd sauce-cloud && npm run db:reset`
Expected: clean apply; `select relrowsecurity from pg_class where relname='credit_ledger';` → `t`.

- [ ] **Step 3: Commit**

```bash
git add sauce-cloud/supabase/migrations/0003_rls.sql
git commit -m "feat(sauce-cloud): RLS policies + least-privilege grants (money tables write-locked)"
```

---

### Task 4: Atomic credit RPCs

**Files:**
- Create: `sauce-cloud/supabase/migrations/0004_credit_rpcs.sql`

- [ ] **Step 1: Write the migration**

```sql
-- 0004_credit_rpcs.sql — the ONLY writers to credit_ledger / credit_balances.
-- SECURITY DEFINER + empty search_path; callable by service_role only.

-- reserve_credits: atomically hold `estimate` µ-credits. Race-safe: the guarded
-- UPDATE row-locks the balance, so concurrent reserves cannot overspend.
-- Returns the new reservation's ledger id, or NULL when insufficient.
create or replace function public.reserve_credits(
  p_account uuid, p_estimate bigint, p_reason text default null
) returns bigint
language plpgsql security definer set search_path = '' as $$
declare v_new bigint; v_res_id bigint;
begin
  if p_estimate <= 0 then raise exception 'estimate must be positive'; end if;
  update public.credit_balances
    set balance = balance - p_estimate, updated_at = now()
    where account_id = p_account and balance >= p_estimate
    returning balance into v_new;
  if not found then
    return null;  -- insufficient credits (or no balance row) → paywall
  end if;
  insert into public.credit_ledger (account_id, kind, amount, reason)
    values (p_account, 'reserve', -p_estimate, p_reason)
    returning id into v_res_id;
  return v_res_id;
end $$;

-- commit_usage: settle a reservation to the actual charge. Releases the
-- (estimate - actual) difference back to the balance; records the usage event.
-- Runs in its own short transaction (no lock held across the upstream call).
create or replace function public.commit_usage(
  p_reservation bigint, p_account uuid, p_actual bigint, p_model text,
  p_input int, p_output int, p_request_id text, p_install uuid default null,
  p_provider text default null
) returns void
language plpgsql security definer set search_path = '' as $$
declare v_reserved bigint; v_diff bigint;
begin
  select -amount into v_reserved from public.credit_ledger
    where id = p_reservation and account_id = p_account and kind = 'reserve';
  if v_reserved is null then raise exception 'unknown reservation %', p_reservation; end if;
  v_diff := v_reserved - p_actual;             -- positive ⇒ refund the over-estimate
  insert into public.credit_ledger (account_id, kind, amount, reason, ref)
    values (p_account, 'commit', 0, 'settle', p_reservation::text);
  if v_diff <> 0 then
    update public.credit_balances set balance = balance + v_diff, updated_at = now()
      where account_id = p_account;
    insert into public.credit_ledger (account_id, kind, amount, reason, ref)
      values (p_account, 'release', v_diff, 'settle-diff', p_reservation::text);
  end if;
  insert into public.usage_events
    (account_id, install_id, model_id, input_tokens, output_tokens,
     credits_charged, request_id, status, upstream_provider)
    values (p_account, p_install, p_model, p_input, p_output,
            p_actual, p_request_id, 'ok', p_provider);
end $$;

-- release_reservation: full refund on upstream error/abort.
create or replace function public.release_reservation(
  p_reservation bigint, p_account uuid
) returns void
language plpgsql security definer set search_path = '' as $$
declare v_reserved bigint;
begin
  select -amount into v_reserved from public.credit_ledger
    where id = p_reservation and account_id = p_account and kind = 'reserve';
  if v_reserved is null then return; end if;
  update public.credit_balances set balance = balance + v_reserved, updated_at = now()
    where account_id = p_account;
  insert into public.credit_ledger (account_id, kind, amount, reason, ref)
    values (p_account, 'release', v_reserved, 'reservation released', p_reservation::text);
end $$;

-- grant_monthly_credits: idempotent per (account, period). Reset-to-allotment,
-- no rollover — sets balance to the plan's monthly_credits for the period.
create or replace function public.grant_monthly_credits(
  p_account uuid, p_plan text, p_period text
) returns void
language plpgsql security definer set search_path = '' as $$
declare v_amount bigint; v_key text := p_account::text || ':' || p_period;
begin
  select monthly_credits into v_amount from public.plans where id = p_plan;
  if v_amount is null then raise exception 'unknown plan %', p_plan; end if;
  insert into public.credit_ledger (account_id, kind, amount, reason, idempotency_key)
    values (p_account, 'grant', v_amount, 'monthly grant ' || p_period, v_key)
    on conflict (idempotency_key) do nothing;
  if not found then return; end if;       -- already granted this period
  insert into public.credit_balances (account_id, balance, updated_at)
    values (p_account, v_amount, now())
    on conflict (account_id) do update set balance = excluded.balance, updated_at = now();
end $$;

-- Only the service role (gateway / edge functions) may call these.
revoke all on function public.reserve_credits(uuid,bigint,text) from public, anon, authenticated;
revoke all on function public.commit_usage(bigint,uuid,bigint,text,int,int,text,uuid,text) from public, anon, authenticated;
revoke all on function public.release_reservation(bigint,uuid) from public, anon, authenticated;
revoke all on function public.grant_monthly_credits(uuid,text,text) from public, anon, authenticated;
grant execute on function public.reserve_credits(uuid,bigint,text) to service_role;
grant execute on function public.commit_usage(bigint,uuid,bigint,text,int,int,text,uuid,text) to service_role;
grant execute on function public.release_reservation(bigint,uuid) to service_role;
grant execute on function public.grant_monthly_credits(uuid,text,text) to service_role;
```

- [ ] **Step 2: Apply + verify**

Run: `cd sauce-cloud && npm run db:reset`
Expected: all four functions created; `\df public.*` lists them.

- [ ] **Step 3: Commit**

```bash
git add sauce-cloud/supabase/migrations/0004_credit_rpcs.sql
git commit -m "feat(sauce-cloud): atomic credit RPCs (reserve/commit/release/grant), service-role only"
```

---

### Task 5: Seed plans + model catalog

**Files:**
- Create: `sauce-cloud/supabase/seed.sql`

- [ ] **Step 1: Write the seed** (credits are µ; 1 credit = 1e6 µ. Free = 2,000 credits/mo, Plus = 250,000, Pro = 1,500,000 — placeholders, tune later.)

```sql
-- seed.sql — plans + model catalog (µ-credits). Tune amounts/prices later.
insert into public.plans (id, name, monthly_credits, price_cents, stripe_price_id, tier_rank, features) values
  ('free', 'Free',   2000000000,        0, null,                0, '{"hosted_memory": false}'),
  ('plus', 'Plus',   250000000000,   1900, 'price_PLACEHOLDER_PLUS', 1, '{"hosted_memory": true}'),
  ('pro',  'Pro',  1500000000000,   4900, 'price_PLACEHOLDER_PRO',  2, '{"hosted_memory": true}')
on conflict (id) do nothing;

insert into public.model_catalog (id, provider, display_name, credit_per_1k_input, credit_per_1k_output, min_tier_rank, enabled) values
  ('anthropic/claude-haiku-4-5-20251001', 'anthropic', 'Claude Haiku 4.5', 800000,   4000000,  0, true),
  ('openai/gpt-4o-mini',                  'openai',    'GPT-4o mini',      150000,    600000,  0, true),
  ('anthropic/claude-sonnet-4-6',         'anthropic', 'Claude Sonnet 4.6', 3000000, 15000000, 1, true),
  ('openai/gpt-4o',                       'openai',    'GPT-4o',           2500000, 10000000,  1, true),
  ('anthropic/claude-opus-4-7',           'anthropic', 'Claude Opus 4.7', 15000000, 75000000,  2, true)
on conflict (id) do nothing;
```

- [ ] **Step 2: Apply + verify**

Run: `cd sauce-cloud && npm run db:reset`
Expected: `select count(*) from public.plans;` → 3; `select count(*) from public.model_catalog;` → 5.

- [ ] **Step 3: Commit**

```bash
git add sauce-cloud/supabase/seed.sql
git commit -m "feat(sauce-cloud): seed plans + model catalog (placeholder pricing)"
```

---

### Task 6: Test harness + helpers

**Files:**
- Create: `sauce-cloud/test/_helpers.ts`

- [ ] **Step 1: Write the helpers** (read local keys from env; the worker exports them before `vitest` — see Step 2).

```ts
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
// `supabase status -o env` emits API_URL / ANON_KEY / SERVICE_ROLE_KEY (CLI 2.84).
// Accept SUPABASE_* fallbacks too. NOTE: this local stack runs on remapped ports
// (api 54521) because other Supabase stacks occupy the defaults — always source
// the values from `supabase status -o env`, never hardcode 54321.
const URL = process.env.API_URL ?? process.env.SUPABASE_URL ?? "http://127.0.0.1:54521";
const ANON = (process.env.ANON_KEY ?? process.env.SUPABASE_ANON_KEY)!;
const SERVICE = (process.env.SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY)!;

export const service = (): SupabaseClient =>
  createClient(URL, SERVICE, { auth: { persistSession: false } });
export const anon = (): SupabaseClient =>
  createClient(URL, ANON, { auth: { persistSession: false } });

/** Create a confirmed auth user + its accounts row, return {id, client}. */
export async function makeUser(plan = "free") {
  const svc = service();
  const email = `u${Date.now()}_${Math.random().toString(36).slice(2)}@test.local`;
  const { data, error } = await svc.auth.admin.createUser({
    email, password: "pw-123456", email_confirm: true,
  });
  if (error) throw error;
  const id = data.user!.id;
  await svc.from("accounts").insert({ id, plan_id: plan });
  await svc.from("credit_balances").insert({ account_id: id, balance: 0 });
  const userClient = createClient(URL, ANON, { auth: { persistSession: false } });
  await userClient.auth.signInWithPassword({ email, password: "pw-123456" });
  return { id, email, client: userClient };
}
```

- [ ] **Step 2: Document the test run sequence in `sauce-cloud/README.md`**

Append: `Run tests: \`supabase start\`, then \`eval "$(supabase status -o env | grep -E '^(API_URL|ANON_KEY|SERVICE_ROLE_KEY)=' | sed 's/^/export /')"\` (eval — the values are double-quoted, so a bare \`export $(...)\` malforms the keys) and \`npm test\`. \`supabase db reset\` between full runs for a clean ledger.` (The helper also accepts SUPABASE_URL/SUPABASE_ANON_KEY/SUPABASE_SERVICE_ROLE_KEY.)

- [ ] **Step 3: Commit**

```bash
git add sauce-cloud/test/_helpers.ts sauce-cloud/README.md
git commit -m "test(sauce-cloud): supabase-js test helpers (service/anon/makeUser)"
```

---

### Task 7: RLS isolation tests

**Files:**
- Create: `sauce-cloud/test/rls.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { makeUser, service } from "./_helpers";

describe("RLS isolation", () => {
  it("a user reads only their own balance, never another's", async () => {
    const a = await makeUser();
    const b = await makeUser();
    await service().from("credit_balances").update({ balance: 500 }).eq("account_id", a.id);
    await service().from("credit_balances").update({ balance: 999 }).eq("account_id", b.id);

    const { data } = await a.client.from("credit_balances").select("account_id,balance");
    expect(data).toHaveLength(1);
    expect(data![0].account_id).toBe(a.id);
    expect(data![0].balance).toBe(500);
  });

  it("a client cannot write the ledger directly (no insert grant)", async () => {
    const a = await makeUser();
    const { error } = await a.client.from("credit_ledger")
      .insert({ account_id: a.id, kind: "grant", amount: 1000000 });
    expect(error).toBeTruthy(); // permission denied / RLS
  });

  it("plans + model_catalog are publicly readable", async () => {
    const a = await makeUser();
    const { data } = await a.client.from("model_catalog").select("id").eq("enabled", true);
    expect((data ?? []).length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run to verify it passes** (the schema/RLS already exist from Tasks 1–5)

Run: `cd sauce-cloud && npm test -- rls`
Expected: PASS (3 tests). If the ledger-insert test FAILS (insert succeeds), the grants in Task 3 are wrong — fix `0003_rls.sql` so `credit_ledger` has no client insert grant, `db:reset`, re-run.

- [ ] **Step 3: Commit**

```bash
git add sauce-cloud/test/rls.test.ts
git commit -m "test(sauce-cloud): RLS isolation + money-table write-lock"
```

---

### Task 8: Credit RPC behavior + concurrency (no-overspend) tests

**Files:**
- Create: `sauce-cloud/test/credits.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from "vitest";
import { makeUser, service } from "./_helpers";

async function setBalance(id: string, bal: number) {
  await service().from("credit_balances").update({ balance: bal }).eq("account_id", id);
}
async function getBalance(id: string): Promise<number> {
  const { data } = await service().from("credit_balances").select("balance").eq("account_id", id).single();
  return data!.balance;
}

describe("credit RPCs", () => {
  it("reserve then commit charges the ACTUAL amount and refunds the estimate diff", async () => {
    const u = await makeUser(); await setBalance(u.id, 1000);
    const svc = service();
    const { data: resId } = await svc.rpc("reserve_credits", { p_account: u.id, p_estimate: 400 });
    expect(resId).toBeTruthy();
    expect(await getBalance(u.id)).toBe(600);            // estimate held
    await svc.rpc("commit_usage", {
      p_reservation: resId, p_account: u.id, p_actual: 250, p_model: "openai/gpt-4o-mini",
      p_input: 100, p_output: 50, p_request_id: "req-1",
    });
    expect(await getBalance(u.id)).toBe(750);            // 1000 - 250 actual
    const { count } = await svc.from("usage_events").select("*", { count: "exact", head: true }).eq("account_id", u.id);
    expect(count).toBe(1);
  });

  it("reserve returns null (paywall) when balance is insufficient and does NOT decrement", async () => {
    const u = await makeUser(); await setBalance(u.id, 100);
    const { data: resId } = await service().rpc("reserve_credits", { p_account: u.id, p_estimate: 500 });
    expect(resId).toBeNull();
    expect(await getBalance(u.id)).toBe(100);            // untouched
  });

  it("release refunds a held reservation in full", async () => {
    const u = await makeUser(); await setBalance(u.id, 1000);
    const svc = service();
    const { data: resId } = await svc.rpc("reserve_credits", { p_account: u.id, p_estimate: 300 });
    await svc.rpc("release_reservation", { p_reservation: resId, p_account: u.id });
    expect(await getBalance(u.id)).toBe(1000);
  });

  it("concurrent reserves never overspend (only as many as the balance allows succeed)", async () => {
    const u = await makeUser(); await setBalance(u.id, 1000);
    const svc = service();
    // 10 concurrent reserves of 200 against a 1000 balance ⇒ at most 5 succeed.
    const results = await Promise.all(
      Array.from({ length: 10 }, () => svc.rpc("reserve_credits", { p_account: u.id, p_estimate: 200 })),
    );
    const ok = results.filter((r) => r.data != null).length;
    expect(ok).toBe(5);
    expect(await getBalance(u.id)).toBe(0);
    expect(await getBalance(u.id)).toBeGreaterThanOrEqual(0); // never negative
  });

  it("grant_monthly_credits is idempotent per period (reset-to-allotment)", async () => {
    const u = await makeUser("plus"); await setBalance(u.id, 5);
    const svc = service();
    await svc.rpc("grant_monthly_credits", { p_account: u.id, p_plan: "plus", p_period: "2026-05" });
    const after1 = await getBalance(u.id);
    await svc.rpc("grant_monthly_credits", { p_account: u.id, p_plan: "plus", p_period: "2026-05" });
    const after2 = await getBalance(u.id);
    expect(after1).toBe(250000000000);   // reset to Plus allotment
    expect(after2).toBe(after1);         // second call same period is a no-op
  });
});
```

- [ ] **Step 2: Run to verify they pass**

Run: `cd sauce-cloud && npm test -- credits`
Expected: PASS (5 tests). The concurrency test is the keystone — if `ok !== 5` or balance goes negative, the guarded `UPDATE` in `reserve_credits` is wrong (must be a single `update … where balance >= estimate returning`, not select-then-update).

- [ ] **Step 3: Commit**

```bash
git add sauce-cloud/test/credits.test.ts
git commit -m "test(sauce-cloud): credit RPC settle/paywall/release + no-overspend concurrency"
```

---

## Self-Review

**Spec coverage (§3 data model / §4C grant / §7 security / §8 testing):**
- accounts/installs/plans/model_catalog → Task 1 ✓
- subscriptions/webhook_events/credit_ledger/credit_balances/usage_events → Task 2 ✓
- RLS + least privilege (money tables write-locked) → Task 3 ✓ (tested Task 7)
- reserve/commit/release/grant_monthly_credits (atomic, service-role only) → Task 4 ✓ (tested Task 8)
- seed plans + catalog (entitlement via tier_rank) → Task 5 ✓
- reserve→commit/release as two short txns, no lock across upstream call → Task 4 design + comments ✓
- testing: RLS isolation, no-overspend concurrency, idempotent grant → Tasks 7–8 ✓

Not in this plan (correct — later subsystems): the gateway's reserve/commit *calls* (Subsystem 3), Stripe webhook → grant wiring (Subsystem 2), `account-provision`/install-claim edge function (Subsystem 2), `pg_cron` free-tier reset (Subsystem 2 deploy). Noted so a reader doesn't expect them here.

**Placeholder scan:** Stripe `price_PLACEHOLDER_*` ids in seed are intentional + labeled (filled when Stripe products exist in Subsystem 2); pricing amounts labeled "tune later". No unlabeled TBDs.

**Type consistency:** function signatures used in Task 8 tests match Task 4 exactly — `reserve_credits(p_account,p_estimate,p_reason?)`, `commit_usage(p_reservation,p_account,p_actual,p_model,p_input,p_output,p_request_id,p_install?,p_provider?)`, `release_reservation(p_reservation,p_account)`, `grant_monthly_credits(p_account,p_plan,p_period)`. Column names (`balance`, `account_id`, `kind`, `amount`, `idempotency_key`) consistent across Tasks 2/4/7/8.
