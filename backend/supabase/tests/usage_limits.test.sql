-- Tests for migration 0003 (run after stubs, schema.sql, 0002, 0003):
--   psql -v ON_ERROR_STOP=1 -f tests/usage_limits.test.sql
-- user_stored_bytes sums past PostgREST's 1000-row cap, and only the
-- Worker's service_role may call it. Rolls back everything it inserts.
begin;
insert into auth.users (id) values ('00000000-0000-4000-8000-0000000003aa');
insert into public.uploads (id, user_id, original_file_name, mime_type, size_bytes, storage_key, status)
select gen_random_uuid(), '00000000-0000-4000-8000-0000000003aa', 'f' || g || '.png', 'image/png', 1000, 'uploads/t/' || g, 'stored'
from generate_series(1, 1500) g;

do $$
begin
  if public.user_stored_bytes('00000000-0000-4000-8000-0000000003aa') <> 1500000 then
    raise exception 'user_stored_bytes: wrong sum';
  end if;
  if public.user_stored_bytes('00000000-0000-4000-8000-0000000003bb') <> 0 then
    raise exception 'user_stored_bytes: a user with no uploads must be 0';
  end if;
  if not has_function_privilege('service_role', 'public.user_stored_bytes(uuid)', 'execute') then
    raise exception 'service_role must be able to call user_stored_bytes';
  end if;
  if has_function_privilege('anon', 'public.user_stored_bytes(uuid)', 'execute')
     or has_function_privilege('authenticated', 'public.user_stored_bytes(uuid)', 'execute') then
    raise exception 'user_stored_bytes must not be callable by anon/authenticated';
  end if;
  raise notice 'usage_limits: all assertions passed';
end $$;
rollback;
