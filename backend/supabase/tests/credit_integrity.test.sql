-- Integration test for supabase/schema.sql + migrations/0002_credit_integrity.sql.
-- Run against a THROWAWAY Postgres database (CI uses a postgres:16 service):
--   psql -v ON_ERROR_STOP=1 -f supabase/tests/supabase_stubs.sql \
--        -f supabase/schema.sql -f supabase/migrations/0002_credit_integrity.sql \
--        -f supabase/tests/credit_integrity.test.sql
-- Any failed assertion raises an exception and aborts with a non-zero exit.

do $$
declare
  u_existing uuid := '00000000-0000-0000-0000-000000000001';
  u_new uuid := '00000000-0000-0000-0000-000000000002';
  v_upload uuid := '00000000-0000-0000-0000-0000000000a1';
  v_job uuid := '00000000-0000-0000-0000-0000000000b1';
  r record;
  v_balance integer;
  v_count integer;
begin
  -- Backfill: the pre-existing user got exactly one signup grant, even though
  -- the migration was applied twice.
  select balance into v_balance from public.credit_balances where user_id = u_existing;
  assert v_balance = 10, format('backfilled balance should be 10, got %s', v_balance);
  select count(*) into v_count from public.credit_transactions where user_id = u_existing;
  assert v_count = 1, format('backfill must grant once, got %s grants', v_count);

  -- Signup trigger grants the free credits.
  insert into auth.users (id) values (u_new);
  select balance into v_balance from public.credit_balances where user_id = u_new;
  assert v_balance = 10, format('signup balance should be 10, got %s', v_balance);

  insert into public.uploads (id, user_id, original_file_name, mime_type, size_bytes, storage_key)
  values (v_upload, u_new, 'a.png', 'image/png', 1, 'k1');
  insert into public.jobs (id, user_id, upload_id, status) values (v_job, u_new, v_upload, 'completed');

  -- Debit once; a duplicate debit for the same job is a no-op.
  select * into r from public.apply_credit_entry(u_new, -3, 'debit', 'job', v_job);
  assert not r.duplicate and r.balance = 7, 'first debit applies';
  select * into r from public.apply_credit_entry(u_new, -3, 'debit', 'job', v_job);
  assert r.duplicate and r.balance = 7, 'duplicate debit is a no-op';

  -- Refund once; a duplicate refund is a no-op; never-charged jobs refund nothing.
  select * into r from public.refund_job_credits(u_new, v_job, 'r');
  assert not r.duplicate and r.balance = 10, 'refund restores the debit';
  select * into r from public.refund_job_credits(u_new, v_job, 'r');
  assert r.duplicate and r.balance = 10, 'duplicate refund is a no-op';
  select count(*) into v_count from public.refund_job_credits(u_new, '00000000-0000-0000-0000-0000000000ff', 'r');
  assert v_count = 0, 'refund of a never-charged job returns nothing';

  -- Grants are idempotent per key.
  select * into r from public.apply_credit_entry(u_new, 5, 'credit', 'promo', null, 'promo-1');
  assert not r.duplicate and r.balance = 15, 'keyed grant applies';
  select * into r from public.apply_credit_entry(u_new, 5, 'credit', 'promo', null, 'promo-1');
  assert r.duplicate and r.balance = 15, 'repeated keyed grant is a no-op';

  -- Overdraft is rejected and leaves the balance untouched.
  begin
    perform public.apply_credit_entry(u_new, -16, 'debit', 'overdraft', null);
    raise exception 'overdraft should have been rejected';
  exception when others then
    assert sqlerrm like '%insufficient_credits%', format('unexpected error: %s', sqlerrm);
  end;
  select balance into v_balance from public.credit_balances where user_id = u_new;
  assert v_balance = 15, 'balance unchanged after rejected overdraft';

  -- The CHECK constraint backs this up even for direct writes.
  begin
    update public.credit_balances set balance = -1 where user_id = u_new;
    raise exception 'negative balance should violate the check constraint';
  exception when check_violation then
    null;
  end;

  -- At most one active job per upload.
  insert into public.jobs (user_id, upload_id, status) values (u_new, v_upload, 'queued');
  begin
    insert into public.jobs (user_id, upload_id, status) values (u_new, v_upload, 'processing');
    raise exception 'second active job should violate the unique index';
  exception when unique_violation then
    null;
  end;

  raise notice 'credit_integrity: all assertions passed';
end;
$$;

-- Clients must not be able to call the ledger functions.
set role anon;
do $$
begin
  perform public.apply_credit_entry('00000000-0000-0000-0000-000000000002', 1000, 'credit', 'hack', null);
  raise exception 'anon must not be able to call apply_credit_entry';
exception when insufficient_privilege then
  raise notice 'credit_integrity: anon is denied';
end;
$$;
reset role;

-- The Worker (service-role key) can read and write every table it uses and
-- call the ledger functions; RLS does not block it (service_role bypasses RLS).
set role service_role;
do $$
declare
  u uuid := '00000000-0000-0000-0000-000000000001';
  up uuid := gen_random_uuid();
  j uuid := gen_random_uuid();
  before_balance integer;
  r record;
begin
  select balance into before_balance from public.credit_balances where user_id = u;
  perform 1 from public.profiles where id = u;
  insert into public.uploads (id, user_id, original_file_name, mime_type, size_bytes, storage_key)
  values (up, u, 'worker.png', 'image/png', 1, 'worker-' || up);
  insert into public.jobs (id, user_id, upload_id, status) values (j, u, up, 'queued');
  update public.jobs set status = 'processing', version = version + 1 where id = j;
  select * into r from public.apply_credit_entry(u, -1, 'debit', 'worker check', j);
  insert into public.conversions (job_id, user_id, format, storage_key, file_size_bytes) values (j, u, 'svg', 'worker-out-' || j, 10);
  update public.jobs set status = 'completed' where id = j;
  select * into r from public.refund_job_credits(u, j, 'worker check refund');
  assert r.balance = before_balance, 'worker debit + refund nets to zero';
  delete from public.conversions where job_id = j;
  raise notice 'credit_integrity: service_role (Worker) privileges OK';
end;
$$;
reset role;
