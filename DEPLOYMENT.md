# Vectorla — Deployment Runbook

The frontend (`/`, Vite) deploys to **Cloudflare Pages**. The API (`backend/`)
deploys as a **Cloudflare Worker** with R2, Queues and a cron trigger, backed
by **Supabase** (Auth + Postgres). Staging and production are fully separate:
each has its own Worker, bucket, queues and secrets.

> Nothing here has been run against the live accounts yet. The Supabase
> project `rvrpuapbeglqmcajsdgm` was **paused** at the last audit and must be
> resumed by the owner before any step touching the database.

## 0. Prerequisites (owner)

- Cloudflare account with the **Workers Paid** plan (a billing decision for
  the owner). Workers Free allows 10 ms of CPU per invocation, but tracing
  takes seconds, and `[limits] cpu_ms = 60000` is a Paid-only setting.
  Queues, the DLQ and cron triggers also work on Free (Queues: 10,000
  operations/day, 24 h retention), so CPU time is the only hard requirement.
- R2 enabled on the account (free tier: 10 GB-month storage, 1M Class A /
  10M Class B operations per month). Cloudflare may ask for a payment method
  when you enable R2 for the first time.
- Supabase project, resumed and reachable.
- `npx wrangler login` on the deploying machine.

## 1. One-time resources

```bash
cd backend
# production
npx wrangler r2 bucket create vectorla-uploads
npx wrangler queues create vectorla-conversions
npx wrangler queues create vectorla-conversions-dlq
# staging
npx wrangler r2 bucket create vectorla-uploads-staging
npx wrangler queues create vectorla-conversions-staging
npx wrangler queues create vectorla-conversions-staging-dlq
```

## 2. Database (per Supabase project: staging first, then production)

In order, in the SQL editor or with `psql`:

0. `backend/supabase/preflight_0002.sql` (read-only). It reports which
   objects already exist, row counts, Worker/anon/authenticated table
   privileges, RLS per table, and rows that would violate 0002. **Every
   `violations` row must be 0** before you continue. If one isn't, stop and
   decide how to repair the data; never delete it blindly.
1. `backend/supabase/schema.sql` (base schema, RLS, profile trigger, and the
   six `service_role` table GRANTs)
2. `backend/supabase/migrations/0002_credit_integrity.sql` (atomic credit
   ledger, balance ≥ 0, one active job per upload, the same six
   `service_role` GRANTs, free signup credits via a separate trigger, and a
   backfill for existing users). Runs in one transaction, so a failure
   applies nothing.
3. Re-run `preflight_0002.sql`. Expect every `0002:` object to be `t`,
   `service_role` to be `t` on all six tables, anon and authenticated to be
   `f`, RLS to be `t`, and violations to be 0.

Both files are idempotent, and the order is robust. Re-running `schema.sql`
after 0002 keeps the signup grant, because it lives in its own trigger
(`on_auth_user_created_grant_credits`) rather than in `handle_new_user`.
CI runs the stubs, schema, the migration twice, and
`supabase/tests/credit_integrity.test.sql` against Postgres 16 on every
push. The tests cover ledger invariants, anon denial, and a full Worker
cycle as `service_role`.

**Why the GRANTs:** projects created with automatic Data API grants
disabled give `service_role` no table privileges. Every Worker query then
fails with `permission denied for table profiles`. This was reproduced
offline: with the GRANTs, the full upload → job → debit → conversion →
refund cycle passes as `service_role`.

Supabase Auth settings to confirm: the site URL and redirect allowlist
(`https://vectorla.app`, and the staging Pages URL), email confirmation, the
password policy, and SMTP sender. The signup grant is 10 credits
(`FREE_SIGNUP_CREDITS` in `backend/src/config/index.ts` must match the SQL).

## 3. Worker secrets

```bash
cd backend
for env in "" "--env staging"; do
  npx wrangler secret put SUPABASE_URL $env
  npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY $env
  npx wrangler secret put DOWNLOAD_URL_SECRET $env   # a long random string, different per environment
done
```

Staging and production fail closed (every API call returns an error) if any of these are missing.

## 4. Deploy the Worker

```bash
cd backend
npm ci && npm run typecheck && npm test      # includes the vector-quality gate
npx wrangler deploy --dry-run --env staging  # offline: bundle + bindings check
npx wrangler deploy --dry-run --env=""
npx wrangler deploy --env staging            # vectorla-api-staging
npx wrangler deploy --env=""                 # vectorla-api (production)
```

CORS always allows `https://vectorla.app` and `https://www.vectorla.app`.
Before staging is used from a browser, set `CORS_EXTRA_ORIGINS` in
`[env.staging.vars]` (`wrangler.toml`) to the staging frontend's exact
origin, e.g. `https://staging.<pages-project>.pages.dev`. Only exact
`https://` origins are accepted, with no wildcards.

## 5. Deploy the frontend (Cloudflare Pages)

- Build command: `npm run build` · output: `dist`
- Environment variables (per Pages environment):
  - `VITE_API_BASE_URL`: the Worker URL for that environment
  - `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`: publishable key
    only, never the service-role key
- `public/_headers` sets the CSP, including `blob:` for image previews and
  the API/Supabase hosts in `connect-src`. Narrow `https://*.workers.dev` once
  the final API host is known.

## 6. Verify after each deploy

1. `GET <api>/api/v1/health` returns `{"status":"ok","environment":"<env>"}`.
2. Sign up a new user. `GET /api/v1/credits` shows **10**.
3. Upload a PNG logo. The job completes, the SVG downloads, and the balance is **9**.
4. Upload a JPEG and run a Professional trace. The job completes and the balance drops by **2**.
5. Upload an oversized image (e.g. a PNG header claiming 30000×30000). It is
   rejected with **413** before decoding.
6. `npx wrangler tail` shows no errors, and the cron sweeper runs every 15 minutes
   with no "failed and refunded" messages on a healthy system.

## Local development with local Supabase (no hosted project needed)

Needs Docker (Windows: Docker Desktop with the WSL 2 backend) and Node 22.
Everything runs on your machine; the keys printed by `supabase status` are
fixed local-development defaults, not production secrets. Still, keep them
only in the gitignored files below.

1. Outside the repo, create a Supabase workdir:
   `npx supabase@latest init` (accept the defaults). Then start only the core
   services:
   `npx supabase start -x realtime,studio,storage-api,imgproxy,edge-runtime,logflare,vector,postgres-meta,supavisor,mailpit`.
2. `npx supabase status -o env` prints `API_URL`, `DB_URL`, `ANON_KEY` and
   `SERVICE_ROLE_KEY`.
3. Database, in the same order as production (§2): run
   `psql "$DB_URL" -f backend/supabase/preflight_0002.sql`, stop if any
   violation is not 0 or null, then apply `schema.sql` and
   `migrations/0002_credit_integrity.sql`.
4. `backend/.dev.vars` (gitignored): `SUPABASE_URL=<API_URL>`,
   `SUPABASE_SERVICE_ROLE_KEY=<SERVICE_ROLE_KEY>`,
   `DOWNLOAD_URL_SECRET=<any random string>`. Then run `cd backend && npm run dev`.
   R2 and Queues are simulated locally by wrangler, and the queue consumer
   runs too.
5. `.env.local` (gitignored): `VITE_API_BASE_URL=http://127.0.0.1:8787`,
   `VITE_SUPABASE_URL=<API_URL>`, `VITE_SUPABASE_PUBLISHABLE_KEY=<ANON_KEY>`.
   Then run `npm run dev` and open http://localhost:5173.

Local email confirmation is off by default, so signup signs you in
immediately. `npx supabase stop` stops everything; `supabase db reset` wipes
the local database.

## Rollback

- Worker: `npx wrangler rollback` (per environment).
- Pages: promote the previous deployment in the dashboard.
- Database: the migration is additive (a constraint, indexes, a column,
  functions, a trigger, GRANTs). To undo the signup grant:
  `drop trigger on_auth_user_created_grant_credits on auth.users;`. Don't drop the ledger functions
  while a Worker that calls them is deployed.
