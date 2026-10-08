-- Tests for migration 0004 (run after stubs, schema.sql, 0002, 0003, 0004).
-- handle_new_user() is not callable by anon/authenticated, and signup still
-- creates the profile and grants 10 credits. Rolls back what it inserts.
begin;
do $$
declare
  u uuid := '00000000-0000-4000-8000-0000000004aa';
  b int;
begin
  if has_function_privilege('anon', 'public.handle_new_user()', 'execute')
     or has_function_privilege('authenticated', 'public.handle_new_user()', 'execute') then
    raise exception 'handle_new_user must not be callable by anon/authenticated';
  end if;
  insert into auth.users (id) values (u);
  if not exists (select 1 from public.profiles where id = u) then
    raise exception 'signup no longer creates a profile';
  end if;
  select balance into b from public.credit_balances where user_id = u;
  if b is distinct from 10 then
    raise exception 'signup grant is %, expected 10', b;
  end if;
  raise notice 'hardening_0004: all assertions passed';
end $$;
rollback;
