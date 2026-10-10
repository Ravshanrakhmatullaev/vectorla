-- STAGING ONLY (project rvrpuapbeglqmcajsdgm). Deletes the six E2E test
-- accounts created on 2026-10-09 and, through ON DELETE CASCADE, their
-- profiles, uploads, jobs, conversions, credit balances, credit
-- transactions, identities and sessions. Their R2 objects were already
-- deleted. Run it in the Supabase SQL editor.
--
-- One atomic block: any failed check raises, and nothing is deleted.
-- It deletes only rows that match all three of: the six ids below, the
-- vectorla_e2e = '2026-10-09' tag, and the run's e-mail pattern.
do $$
declare
  target_ids constant uuid[] := array[
    'f9881f06-15c3-402b-80f1-abae1bd0bc34',
    'cf85e8aa-e5ba-43bf-b12b-5640179af4b4',
    '08316973-ef39-4fd5-a93a-c489b0320a64',
    '8709ea5d-5ea8-4b12-a926-0d39758057c1',
    'b9668eb3-a708-40c1-8ca0-bc2849fe1f2e',
    '923c1664-3f56-4111-a1aa-71bdf4853324'
  ]::uuid[];
  matched integer;
  others_before integer;
  others_after integer;
  other_rows_before bigint;
  other_rows_after bigint;
  deleted integer;
begin
  -- 1. Each of the six ids is a tagged test account with the test e-mail.
  select count(*) into matched
  from auth.users
  where id = any (target_ids)
    and raw_user_meta_data ->> 'vectorla_e2e' = '2026-10-09'
    and email like 'vectorla-e2e-cb7d05-u_@example.com';
  if matched <> 6 then
    raise exception 'Expected 6 tagged test users, found %. Nothing deleted.', matched;
  end if;

  -- 2. No tagged or test-pattern account exists outside the list (catches a typo).
  if exists (
    select 1 from auth.users
    where (raw_user_meta_data ->> 'vectorla_e2e' = '2026-10-09' or email like 'vectorla-e2e-cb7d05-%')
      and not (id = any (target_ids))
  ) then
    raise exception 'A tagged test account is not in the list. Nothing deleted.';
  end if;

  -- 3. No conversion is in flight for these users.
  if exists (select 1 from public.jobs where user_id = any (target_ids) and status in ('queued', 'processing')) then
    raise exception 'A test user still has a queued/processing job. Nothing deleted.';
  end if;

  -- 4. No other user's row hangs off a test user's upload or job (the cascade would remove it).
  if exists (
    select 1 from public.jobs j join public.uploads u on u.id = j.upload_id
    where u.user_id = any (target_ids) and not (j.user_id = any (target_ids))
  ) or exists (
    select 1 from public.conversions c join public.jobs j on j.id = c.job_id
    where j.user_id = any (target_ids) and not (c.user_id = any (target_ids))
  ) then
    raise exception 'Another user''s data references a test user''s rows. Nothing deleted.';
  end if;

  select count(*) into others_before from auth.users where not (id = any (target_ids));
  select (select count(*) from public.profiles where not (id = any (target_ids)))
       + (select count(*) from public.uploads where not (user_id = any (target_ids)))
       + (select count(*) from public.jobs where not (user_id = any (target_ids)))
       + (select count(*) from public.conversions where not (user_id = any (target_ids)))
       + (select count(*) from public.credit_balances where not (user_id = any (target_ids)))
       + (select count(*) from public.credit_transactions where not (user_id = any (target_ids)))
    into other_rows_before;

  delete from auth.users
  where id = any (target_ids)
    and raw_user_meta_data ->> 'vectorla_e2e' = '2026-10-09'
    and email like 'vectorla-e2e-cb7d05-u_@example.com';
  get diagnostics deleted = row_count;

  select count(*) into others_after from auth.users where not (id = any (target_ids));
  select (select count(*) from public.profiles where not (id = any (target_ids)))
       + (select count(*) from public.uploads where not (user_id = any (target_ids)))
       + (select count(*) from public.jobs where not (user_id = any (target_ids)))
       + (select count(*) from public.conversions where not (user_id = any (target_ids)))
       + (select count(*) from public.credit_balances where not (user_id = any (target_ids)))
       + (select count(*) from public.credit_transactions where not (user_id = any (target_ids)))
    into other_rows_after;

  -- 5. Exactly six deleted, every other user and their rows untouched, nothing left behind.
  if deleted <> 6 or others_after <> others_before or other_rows_after <> other_rows_before
     or exists (select 1 from public.profiles where id = any (target_ids))
     or exists (select 1 from public.credit_transactions where user_id = any (target_ids)) then
    raise exception 'Post-check failed (deleted %, other users % -> %, other rows % -> %). Rolled back.',
      deleted, others_before, others_after, other_rows_before, other_rows_after;
  end if;

  raise notice 'Deleted % test users and their data; % other users and % of their rows untouched.',
    deleted, others_after, other_rows_after;
end
$$;
