-- Minimal stand-ins for what a Supabase project provides, so schema.sql and
-- the migrations can be tested on plain Postgres. Test databases only.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role; end if;
  -- Supabase's service_role bypasses RLS; the Worker relies on that.
  alter role service_role bypassrls;
end;
$$;
create schema if not exists auth;
create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  raw_user_meta_data jsonb default '{}'
);
-- A user that exists before the migration, to exercise the backfill.
insert into auth.users (id) values ('00000000-0000-0000-0000-000000000001') on conflict do nothing;
