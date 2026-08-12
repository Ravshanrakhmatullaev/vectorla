-- Vectorla backend schema (Supabase / Postgres)
-- Run against a Supabase project once real backend implementation begins.
-- Mirrors the TypeScript types in backend/src/types/.

create table if not exists profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  avatar_url text,
  plan text not null default 'free' check (plan in ('free', 'starter', 'pro', 'business')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists uploads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles (id) on delete cascade,
  original_file_name text not null,
  mime_type text not null,
  size_bytes bigint not null,
  storage_key text not null,
  status text not null default 'pending' check (status in ('pending', 'stored', 'failed')),
  created_at timestamptz not null default now()
);

-- Phase 18: closes the check-then-insert race in UploadService.createUpload —
-- SupabaseUploadsRepository.create() catches this constraint's violation
-- (Postgres error code 23505) and surfaces it as ConflictError (HTTP 409).
create unique index if not exists uploads_user_filename_unique on uploads (user_id, original_file_name);
create index if not exists uploads_user_id_idx on uploads (user_id);

create table if not exists jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles (id) on delete cascade,
  upload_id uuid not null references uploads (id) on delete cascade,
  status text not null default 'queued' check (status in ('queued', 'processing', 'completed', 'failed')),
  preset text,
  settings jsonb,
  error_message text,
  retry_count integer not null default 0,
  -- Phase 18: optimistic-locking token — SupabaseJobsRepository.update()
  -- conditions its UPDATE on this matching the value it last read.
  version integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);

-- Phase 18: findActiveByUploadId (one active job per upload) and general
-- per-upload/per-user job lookups. Deliberately not a unique index — an
-- upload can have many jobs over time (retries, re-processing), just never
-- more than one queued/processing at once; that invariant is enforced in
-- JobService.createJob, not the database, since Postgres partial-unique
-- indexes would need a hardcoded status list kept in sync with JobStatus.
create index if not exists jobs_upload_id_idx on jobs (upload_id);
create index if not exists jobs_upload_id_status_idx on jobs (upload_id, status);
create index if not exists jobs_user_id_idx on jobs (user_id);

create table if not exists conversions (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references jobs (id) on delete cascade,
  user_id uuid not null references profiles (id) on delete cascade,
  format text not null check (format in ('svg', 'pdf', 'eps', 'dxf', 'png')),
  storage_key text not null,
  file_size_bytes bigint not null,
  created_at timestamptz not null default now()
);

-- Phase 18: storage_key is 1:1 with a Conversion row by construction (see
-- ConversionService.processJob) — unique also makes
-- ConversionsRepository.findByStorageKey (routes/download.ts) an index lookup.
create unique index if not exists conversions_storage_key_unique on conversions (storage_key);
create index if not exists conversions_job_id_idx on conversions (job_id);
create index if not exists conversions_user_id_idx on conversions (user_id);

create table if not exists credit_balances (
  user_id uuid primary key references profiles (id) on delete cascade,
  balance integer not null default 0,
  -- Phase 18: optimistic-locking token — SupabaseCreditsRepository.setBalance()
  -- conditions its UPDATE on this matching the value it last read.
  version integer not null default 1,
  updated_at timestamptz not null default now()
);

create table if not exists credit_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles (id) on delete cascade,
  amount integer not null,
  type text not null check (type in ('debit', 'credit', 'refund')),
  reason text not null,
  job_id uuid references jobs (id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists credit_transactions_user_id_idx on credit_transactions (user_id);
create index if not exists credit_transactions_job_id_idx on credit_transactions (job_id);

-- Every Supabase Auth identity receives the application profile required by
-- the foreign keys above. SECURITY DEFINER is required because signup runs as
-- the Auth service; the empty search_path prevents object-shadowing attacks.
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
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- Applying this schema to an existing project also provisions any Auth users
-- created before the trigger existed.
insert into public.profiles (id, display_name, avatar_url)
select
  id,
  nullif(raw_user_meta_data ->> 'display_name', ''),
  nullif(raw_user_meta_data ->> 'avatar_url', '')
from auth.users
on conflict (id) do nothing;

-- Browser clients use Supabase only for Auth. Application data remains behind
-- the Worker, whose service-role client bypasses RLS after route ownership
-- checks. No anon/authenticated table policies are intentionally created.
alter table public.profiles enable row level security;
alter table public.uploads enable row level security;
alter table public.jobs enable row level security;
alter table public.conversions enable row level security;
alter table public.credit_balances enable row level security;
alter table public.credit_transactions enable row level security;

revoke all privileges on table public.profiles from anon, authenticated;
revoke all privileges on table public.uploads from anon, authenticated;
revoke all privileges on table public.jobs from anon, authenticated;
revoke all privileges on table public.conversions from anon, authenticated;
revoke all privileges on table public.credit_balances from anon, authenticated;
revoke all privileges on table public.credit_transactions from anon, authenticated;
