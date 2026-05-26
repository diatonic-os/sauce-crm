-- 0003_rls.sql — enable + force RLS; per-account read-only; public read for
-- plans/model_catalog; NO client writes to money tables.
revoke all on schema public from public;
do $$
declare t text;
begin
  foreach t in array array['accounts','subscriptions','credit_ledger','credit_balances','usage_events']
  loop
    execute format('alter table public.%I enable row level security;', t);
    execute format('alter table public.%I force row level security;', t);
  end loop;
end $$;
create policy accounts_self_read on public.accounts
  for select to authenticated using ((select auth.uid()) = id);
create policy subs_self_read on public.subscriptions
  for select to authenticated using ((select auth.uid()) = account_id);
create policy ledger_self_read on public.credit_ledger
  for select to authenticated using ((select auth.uid()) = account_id);
create policy balances_self_read on public.credit_balances
  for select to authenticated using ((select auth.uid()) = account_id);
create policy usage_self_read on public.usage_events
  for select to authenticated using ((select auth.uid()) = account_id);
alter table public.plans enable row level security;
alter table public.model_catalog enable row level security;
create policy plans_public_read on public.plans for select to anon, authenticated using (true);
create policy models_public_read on public.model_catalog for select to anon, authenticated using (true);
alter table public.installs enable row level security;
alter table public.installs force row level security;
create policy installs_insert on public.installs
  for insert to anon, authenticated with check (true);
create policy installs_self_rw on public.installs
  for update to authenticated using ((select auth.uid()) = account_id)
  with check ((select auth.uid()) = account_id);
grant usage on schema public to anon, authenticated;
grant select on public.plans, public.model_catalog to anon, authenticated;
grant select on public.accounts, public.subscriptions, public.credit_ledger,
  public.credit_balances, public.usage_events to authenticated;
grant insert, update on public.installs to anon, authenticated;
