-- 0005_settle_idempotency_and_security.sql
-- C1: single-shot settlement (claim a unique 'settle:<reservation>' marker so a
--     duplicate commit, or commit-then-release, can never double-refund).
-- C2: force RLS on webhook_events. M1: tighten installs insert check.

create or replace function public.commit_usage(
  p_reservation bigint, p_account uuid, p_actual bigint, p_model text,
  p_input int, p_output int, p_request_id text, p_install uuid default null,
  p_provider text default null
) returns void
language plpgsql security definer set search_path = '' as $$
declare v_reserved bigint; v_diff bigint; v_claim bigint;
begin
  select -amount into v_reserved from public.credit_ledger
    where id = p_reservation and account_id = p_account and kind = 'reserve';
  if v_reserved is null then raise exception 'unknown reservation %', p_reservation; end if;
  -- Claim the single settle marker; conflict ⇒ already settled (commit or release).
  insert into public.credit_ledger (account_id, kind, amount, reason, ref, idempotency_key)
    values (p_account, 'commit', 0, 'settle', p_reservation::text, 'settle:' || p_reservation)
    on conflict (idempotency_key) do nothing
    returning id into v_claim;
  if v_claim is null then return; end if;       -- already settled → no-op
  v_diff := v_reserved - p_actual;
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

create or replace function public.release_reservation(
  p_reservation bigint, p_account uuid
) returns void
language plpgsql security definer set search_path = '' as $$
declare v_reserved bigint; v_claim bigint;
begin
  select -amount into v_reserved from public.credit_ledger
    where id = p_reservation and account_id = p_account and kind = 'reserve';
  if v_reserved is null then return; end if;
  insert into public.credit_ledger (account_id, kind, amount, reason, ref, idempotency_key)
    values (p_account, 'release', v_reserved, 'reservation released', p_reservation::text, 'settle:' || p_reservation)
    on conflict (idempotency_key) do nothing
    returning id into v_claim;
  if v_claim is null then return; end if;       -- already settled → no-op
  update public.credit_balances set balance = balance + v_reserved, updated_at = now()
    where account_id = p_account;
end $$;

-- C2: webhook_events server-only.
alter table public.webhook_events enable row level security;
alter table public.webhook_events force row level security;

-- M1: an install may only be created unattached or attached to the caller.
drop policy installs_insert on public.installs;
create policy installs_insert on public.installs
  for insert to anon, authenticated
  with check (account_id is null or account_id = (select auth.uid()));
