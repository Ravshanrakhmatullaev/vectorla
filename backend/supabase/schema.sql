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

create table if not exists jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles (id) on delete cascade,
  upload_id uuid not null references uploads (id) on delete cascade,
  status text not null default 'queued' check (status in ('queued', 'processing', 'completed', 'failed')),
  preset text,
  settings jsonb,
  error_message text,
  retry_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);

create table if not exists conversions (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references jobs (id) on delete cascade,
  user_id uuid not null references profiles (id) on delete cascade,
  format text not null check (format in ('svg', 'pdf', 'eps', 'dxf', 'png')),
  storage_key text not null,
  file_size_bytes bigint not null,
  created_at timestamptz not null default now()
);

create table if not exists credit_balances (
  user_id uuid primary key references profiles (id) on delete cascade,
  balance integer not null default 0,
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
