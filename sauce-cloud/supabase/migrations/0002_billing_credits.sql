-- 0002_billing_credits.sql — subscriptions, webhook idempotency, credit ledger.
create table public.subscriptions (
  id                   text primary key,
  account_id           uuid not null references public.accounts (id) on delete cascade,
  plan_id              text not null references public.plans (id),
  status               text not null,
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
create table public.credit_ledger (
  id              bigint generated always as identity primary key,
  account_id      uuid not null references public.accounts (id) on delete cascade,
  ts              timestamptz not null default now(),
  kind            text not null check (kind in ('grant','reserve','commit','release','adjustment')),
  amount          bigint not null,
  reason          text,
  ref             text,
  idempotency_key text unique
);
create index credit_ledger_account_ts_idx on public.credit_ledger (account_id, ts desc);
create table public.credit_balances (
  account_id uuid primary key references public.accounts (id) on delete cascade,
  balance    bigint not null default 0,
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
  credits_charged  bigint not null default 0,
  request_id       text,
  status           text not null check (status in ('ok','error','paywalled')),
  latency_ms       integer,
  upstream_provider text
);
create index usage_events_account_ts_idx on public.usage_events (account_id, ts desc);
