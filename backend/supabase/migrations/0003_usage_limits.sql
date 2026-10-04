-- Vectorla migration 0003: support for usage limits and the orphan sweep.
--
-- Apply AFTER 0002. Idempotent: safe to run more than once. Adds only
-- indexes and one read-only function; changes no data.
--
--   * per-user storage quota: PostgREST returns at most db-max-rows (1000 on
--     Supabase) rows, so summing size_bytes client-side undercounts users
--     with many uploads                                     -> user_stored_bytes()
--   * upload rate limits count a user's uploads since a time -> (user_id, created_at)
--   * concurrency limit counts a user's active jobs         -> (user_id, status)
--   * the orphan sweep looks uploads up by storage_key      -> (storage_key)
--
-- Until this is applied the Worker still works: it falls back to paging the
-- sum (SupabaseUploadsRepository.storedBytesByUser), and the queries run
-- without the new indexes.

begin;

create index if not exists uploads_user_created_idx on public.uploads (user_id, created_at);
create index if not exists uploads_storage_key_idx on public.uploads (storage_key);
create index if not exists jobs_user_status_idx on public.jobs (user_id, status);

create or replace function public.user_stored_bytes(p_user_id uuid)
returns bigint
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(sum(u.size_bytes), 0)::bigint from public.uploads u where u.user_id = p_user_id;
$$;

revoke all on function public.user_stored_bytes(uuid) from public, anon, authenticated;
grant execute on function public.user_stored_bytes(uuid) to service_role;

commit;
