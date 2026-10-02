-- READ-ONLY preflight for migrations/0002_credit_integrity.sql.
-- Run against the real database BEFORE applying the migration. It changes
-- nothing. Every "violations" count must be 0, otherwise the migration's
-- constraints/indexes would fail to build — resolve those rows first.

select 'object' as kind, name, present
from (values
  ('table public.profiles',              to_regclass('public.profiles') is not null),
  ('table public.uploads',               to_regclass('public.uploads') is not null),
  ('table public.jobs',                  to_regclass('public.jobs') is not null),
  ('table public.conversions',           to_regclass('public.conversions') is not null),
  ('table public.credit_balances',       to_regclass('public.credit_balances') is not null),
  ('table public.credit_transactions',   to_regclass('public.credit_transactions') is not null),
  ('function public.handle_new_user',    to_regprocedure('public.handle_new_user()') is not null),
  ('trigger on_auth_user_created',       exists (select 1 from pg_trigger where tgname = 'on_auth_user_created')),
  ('0002: function apply_credit_entry',  to_regprocedure('public.apply_credit_entry(uuid,integer,text,text,uuid,text)') is not null),
  ('0002: function refund_job_credits',  to_regprocedure('public.refund_job_credits(uuid,uuid,text)') is not null),
  ('0002: trigger grant_signup_credits', exists (select 1 from pg_trigger where tgname = 'on_auth_user_created_grant_credits')),
  ('0002: column grant_key',             exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'credit_transactions' and column_name = 'grant_key')),
  ('0002: check balance >= 0',           exists (select 1 from pg_constraint where conname = 'credit_balances_non_negative')),
  ('0002: index one active job/upload',  to_regclass('public.jobs_one_active_per_upload') is not null)
) as t(name, present);

-- Row counts (context for the backfill: each profile gets one signup grant).
select 'count' as kind, 'auth.users' as name, count(*) from auth.users
union all select 'count', 'profiles', count(*) from public.profiles
union all select 'count', 'auth users without profile', count(*) from auth.users u where not exists (select 1 from public.profiles p where p.id = u.id)
union all select 'count', 'credit_balances', count(*) from public.credit_balances
union all select 'count', 'credit_transactions', count(*) from public.credit_transactions
union all select 'count', 'jobs', count(*) from public.jobs;

-- Violations that would make 0002 fail (all must be 0).
select 'violations' as kind, 'negative balances' as name, count(*) from public.credit_balances where balance < 0
union all
select 'violations', 'jobs with >1 debit', count(*) from (select job_id from public.credit_transactions where type = 'debit' and job_id is not null group by job_id having count(*) > 1) d
union all
select 'violations', 'jobs with >1 refund', count(*) from (select job_id from public.credit_transactions where type = 'refund' and job_id is not null group by job_id having count(*) > 1) r
union all
select 'violations', 'uploads with >1 active job', count(*) from (select upload_id from public.jobs where status in ('queued', 'processing') group by upload_id having count(*) > 1) a;

-- Privileges the Worker needs (service_role) and must NOT be exposed (anon/authenticated).
select 'privileges' as kind, r.role || ' on ' || t.tbl as name,
       has_table_privilege(r.role, 'public.' || t.tbl, 'SELECT,INSERT,UPDATE,DELETE') as has_any_dml
from (values ('service_role'), ('anon'), ('authenticated')) as r(role)
cross join (values ('profiles'), ('uploads'), ('jobs'), ('conversions'), ('credit_balances'), ('credit_transactions')) as t(tbl)
where to_regclass('public.' || t.tbl) is not null
order by 2;

-- RLS must be enabled on every application table.
select 'rls' as kind, c.relname as name, c.relrowsecurity as enabled
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname in ('profiles', 'uploads', 'jobs', 'conversions', 'credit_balances', 'credit_transactions')
order by 2;
