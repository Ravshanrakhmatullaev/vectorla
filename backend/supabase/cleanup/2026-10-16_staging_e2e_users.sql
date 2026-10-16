-- STAGING ONLY (project rvrpuapbeglqmcajsdgm). Deletes the four E2E test
-- accounts created on 2026-10-16 (two for the viewer features, two for the
-- upload-failure investigation) and, through ON DELETE CASCADE, their
-- profiles, uploads, jobs, conversions, credit balances, credit
-- transactions, identities and sessions. Their R2 objects expire with the
-- bucket's lifecycle rule and the retention sweep (or delete uploads/<user id>/).
-- Run it in the Supabase SQL editor.
--
-- One atomic block: any failed check raises, and nothing is deleted.
-- It deletes only rows that match all three of: the four ids below, the
-- vectorla_e2e tag ('2026-10-16' or '2026-10-16b'), and the runs' e-mail patterns.
do $$
declare
  target_ids constant uuid[] := array[
    'f68d776c-4588-4cb5-abaa-07d29291e969',
    'f440bfbf-b71f-4a09-b0b8-a53e403e03cb',
    'c7134d59-859b-4ef3-8c4f-fe374878e7b4',
    '1c25d6e0-43be-41db-9119-99af84e81555'
  ]::uuid[];
  matched integer;
  others_before integer;
  others_after integer;
  other_rows_before bigint;
  other_rows_after bigint;
  deleted integer;
begin
  -- 1. Each of the four ids is a tagged test account with the test e-mail.
  select count(*) into matched
  from auth.users
  where id = any (target_ids)
    and raw_user_meta_data ->> 'vectorla_e2e' in ('2026-10-16', '2026-10-16b')
    and (email like 'vectorla-e2e-2a14d1-u_@example.com' or email like 'vectorla-e2e-c5deb6-_@example.com');
  if matched <> 4 then
    raise exception 'Expected 4 tagged test users, found %. Nothing deleted.', matched;
  end if;

  -- 2. No tagged or test-pattern account exists outside the list (catches a typo).
  if exists (
    select 1 from auth.users
    where (raw_user_meta_data ->> 'vectorla_e2e' in ('2026-10-16', '2026-10-16b') or email like 'vectorla-e2e-2a14d1-%' or email like 'vectorla-e2e-c5deb6-%')
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
    and raw_user_meta_data ->> 'vectorla_e2e' in ('2026-10-16', '2026-10-16b')
    and (email like 'vectorla-e2e-2a14d1-u_@example.com' or email like 'vectorla-e2e-c5deb6-_@example.com');
  get diagnostics deleted = row_count;

  select count(*) into others_after from auth.users where not (id = any (target_ids));
  select (select count(*) from public.profiles where not (id = any (target_ids)))
       + (select count(*) from public.uploads where not (user_id = any (target_ids)))
       + (select count(*) from public.jobs where not (user_id = any (target_ids)))
       + (select count(*) from public.conversions where not (user_id = any (target_ids)))
       + (select count(*) from public.credit_balances where not (user_id = any (target_ids)))
       + (select count(*) from public.credit_transactions where not (user_id = any (target_ids)))
    into other_rows_after;

  -- 5. Exactly four deleted, every other user and their rows untouched, nothing left behind.
  if deleted <> 4 or others_after <> others_before or other_rows_after <> other_rows_before
     or exists (select 1 from public.profiles where id = any (target_ids))
     or exists (select 1 from public.credit_transactions where user_id = any (target_ids)) then
    raise exception 'Post-check failed (deleted %, other users % -> %, other rows % -> %). Rolled back.',
      deleted, others_before, others_after, other_rows_before, other_rows_after;
  end if;

  raise notice 'Deleted % test users and their data; % other users and % of their rows untouched.',
    deleted, others_after, other_rows_after;
end
$$;
