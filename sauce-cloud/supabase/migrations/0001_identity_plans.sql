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
  id             text primary key,
  name           text not null,
  monthly_credits bigint not null default 0,
  price_cents    integer not null default 0,
  stripe_price_id text,
  tier_rank      integer not null,
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
  id                  text primary key,
  provider            text not null,
  display_name        text not null,
  credit_per_1k_input  bigint not null,
  credit_per_1k_output bigint not null,
  min_tier_rank       integer not null default 0,
  enabled             boolean not null default true
);
alter table public.accounts
  add constraint accounts_plan_fk foreign key (plan_id) references public.plans (id);
create index accounts_plan_id_idx on public.accounts (plan_id);
