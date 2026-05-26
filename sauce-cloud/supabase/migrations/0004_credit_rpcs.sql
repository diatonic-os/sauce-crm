-- 0004_credit_rpcs.sql — the ONLY writers to credit_ledger / credit_balances.
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
    return null;
  end if;
  insert into public.credit_ledger (account_id, kind, amount, reason)
    values (p_account, 'reserve', -p_estimate, p_reason)
    returning id into v_res_id;
  return v_res_id;
end $$;

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
  v_diff := v_reserved - p_actual;
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
  if not found then return; end if;
  insert into public.credit_balances (account_id, balance, updated_at)
    values (p_account, v_amount, now())
    on conflict (account_id) do update set balance = excluded.balance, updated_at = now();
end $$;

revoke all on function public.reserve_credits(uuid,bigint,text) from public, anon, authenticated;
revoke all on function public.commit_usage(bigint,uuid,bigint,text,int,int,text,uuid,text) from public, anon, authenticated;
revoke all on function public.release_reservation(bigint,uuid) from public, anon, authenticated;
revoke all on function public.grant_monthly_credits(uuid,text,text) from public, anon, authenticated;
grant execute on function public.reserve_credits(uuid,bigint,text) to service_role;
grant execute on function public.commit_usage(bigint,uuid,bigint,text,int,int,text,uuid,text) to service_role;
grant execute on function public.release_reservation(bigint,uuid) to service_role;
grant execute on function public.grant_monthly_credits(uuid,text,text) to service_role;
