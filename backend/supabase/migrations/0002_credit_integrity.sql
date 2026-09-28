-- Vectorla migration 0002: credit integrity, job invariants, signup credits.
--
-- Apply AFTER supabase/schema.sql (schema.sql is the base; this file only
-- adds to it). Idempotent: safe to run more than once.
--
-- Fixes (see ROADMAP.md P4/P5):
--   * balances could go negative under concurrent jobs      -> CHECK + row lock
--   * balance update and ledger insert were separate writes  -> one function
--   * a job could be debited/refunded more than once         -> unique indexes
--   * concurrent POST /jobs could create two active jobs     -> partial unique index
--   * nothing granted credits in production                  -> signup grant + backfill

-- 1. Invariants ---------------------------------------------------------------

alter table public.credit_balances drop constraint if exists credit_balances_non_negative;
alter table public.credit_balances add constraint credit_balances_non_negative check (balance >= 0);

alter table public.credit_transactions add column if not exists grant_key text;

-- At most one debit and one refund per job, and one grant per (user, key).
create unique index if not exists credit_transactions_job_debit_unique
  on public.credit_transactions (job_id) where type = 'debit' and job_id is not null;
create unique index if not exists credit_transactions_job_refund_unique
  on public.credit_transactions (job_id) where type = 'refund' and job_id is not null;
create unique index if not exists credit_transactions_grant_key_unique
  on public.credit_transactions (user_id, grant_key) where grant_key is not null;
create index if not exists credit_transactions_user_created_idx
  on public.credit_transactions (user_id, created_at desc);

-- At most one in-flight job per upload (JobService.createJob maps the
-- resulting unique violation to "return the active job").
create unique index if not exists jobs_one_active_per_upload
  on public.jobs (upload_id) where status in ('queued', 'processing');
-- Stale-job sweeps (scheduled handler) scan by status + updated_at.
create index if not exists jobs_status_updated_idx on public.jobs (status, updated_at);

-- 2. Atomic ledger ------------------------------------------------------------

-- Applies one balance change and its ledger row in a single transaction.
-- The balance row is locked FOR UPDATE, so concurrent calls for the same
-- user serialize; idempotency is checked under that lock. Raises
-- 'insufficient_credits' instead of letting the balance go negative.
create or replace function public.apply_credit_entry(
  p_user_id uuid,
  p_delta integer,
  p_type text,
  p_reason text,
  p_job_id uuid default null,
  p_grant_key text default null
)
returns table (
  id uuid,
  user_id uuid,
  amount integer,
  type text,
  reason text,
  job_id uuid,
  created_at timestamptz,
  duplicate boolean,
  balance integer
)
language plpgsql
security definer set search_path = ''
as $$
declare
  v_balance integer;
  v_existing public.credit_transactions%rowtype;
  v_new public.credit_transactions%rowtype;
begin
  if p_type not in ('debit', 'credit', 'refund') then
    raise exception 'invalid credit entry type %', p_type;
  end if;

  insert into public.credit_balances (user_id, balance)
  values (p_user_id, 0)
  on conflict on constraint credit_balances_pkey do nothing;

  select cb.balance into v_balance
  from public.credit_balances cb
  where cb.user_id = p_user_id
  for update;

  if p_grant_key is not null then
    select * into v_existing from public.credit_transactions t
    where t.user_id = p_user_id and t.grant_key = p_grant_key;
  elsif p_job_id is not null and p_type in ('debit', 'refund') then
    select * into v_existing from public.credit_transactions t
    where t.job_id = p_job_id and t.type = p_type;
  end if;

  if v_existing.id is not null then
    return query select v_existing.id, v_existing.user_id, v_existing.amount, v_existing.type,
      v_existing.reason, v_existing.job_id, v_existing.created_at, true, v_balance;
    return;
  end if;

  if v_balance + p_delta < 0 then
    raise exception 'insufficient_credits' using errcode = 'P0001';
  end if;

  update public.credit_balances cb
  set balance = v_balance + p_delta, version = cb.version + 1, updated_at = now()
  where cb.user_id = p_user_id;

  insert into public.credit_transactions (user_id, amount, type, reason, job_id, grant_key)
  values (p_user_id, abs(p_delta), p_type, p_reason, p_job_id, p_grant_key)
  returning * into v_new;

  return query select v_new.id, v_new.user_id, v_new.amount, v_new.type,
    v_new.reason, v_new.job_id, v_new.created_at, false, v_balance + p_delta;
end;
$$;

-- Refunds a job's debit exactly once. Returns no row if the job was never
-- debited; returns duplicate = true if it was already refunded.
create or replace function public.refund_job_credits(p_user_id uuid, p_job_id uuid, p_reason text)
returns table (
  id uuid,
  user_id uuid,
  amount integer,
  type text,
  reason text,
  job_id uuid,
  created_at timestamptz,
  duplicate boolean,
  balance integer
)
language plpgsql
security definer set search_path = ''
as $$
declare
  v_amount integer;
begin
  select t.amount into v_amount from public.credit_transactions t
  where t.job_id = p_job_id and t.type = 'debit' and t.user_id = p_user_id;
  if v_amount is null then
    return;
  end if;
  return query select * from public.apply_credit_entry(p_user_id, v_amount, 'refund', p_reason, p_job_id, null);
end;
$$;

-- Only the Worker's service-role client may call these.
revoke all on function public.apply_credit_entry(uuid, integer, text, text, uuid, text) from public, anon, authenticated;
revoke all on function public.refund_job_credits(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.apply_credit_entry(uuid, integer, text, text, uuid, text) to service_role;
grant execute on function public.refund_job_credits(uuid, uuid, text) to service_role;

-- 3. Free credits on signup ---------------------------------------------------

-- Signup grant = PLAN_LIMITS.free.monthlyCredits in backend/src/config (10).
-- Keep FREE_SIGNUP_CREDITS in config/index.ts in sync with this value.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name, avatar_url)
  values (
    new.id,
    nullif(new.raw_user_meta_data ->> 'display_name', ''),
    nullif(new.raw_user_meta_data ->> 'avatar_url', '')
  )
  on conflict (id) do nothing;

  perform public.apply_credit_entry(new.id, 10, 'credit', 'Free signup credits', null, 'signup');
  return new;
end;
$$;

-- Backfill: every existing profile receives the signup grant once.
select public.apply_credit_entry(p.id, 10, 'credit', 'Free signup credits', null, 'signup')
from public.profiles p;
