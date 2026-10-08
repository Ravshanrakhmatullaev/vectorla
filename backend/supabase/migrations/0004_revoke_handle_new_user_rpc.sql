-- Vectorla migration 0004: handle_new_user() is a SECURITY DEFINER trigger
-- function, and PostgreSQL grants EXECUTE on new functions to PUBLIC, so the
-- Data API exposed it as /rest/v1/rpc/handle_new_user to anon and signed-in
-- users (Supabase security advisor, lints 0028/0029). Calling it outside a
-- trigger fails, but it should not be reachable at all.
--
-- Revoking EXECUTE does not affect the on_auth_user_created trigger: a
-- trigger's function runs without an EXECUTE check at fire time.
-- Idempotent; changes no data.

revoke all on function public.handle_new_user() from public, anon, authenticated;
