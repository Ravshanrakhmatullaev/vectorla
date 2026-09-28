# Vectorla — Deployment Runbook

The frontend (`/`, Vite) deploys to **Cloudflare Pages**. The API (`backend/`)
deploys as a **Cloudflare Worker** with R2, Queues and a cron trigger, backed
by **Supabase** (Auth + Postgres). Staging and production are fully separate:
each has its own Worker, bucket, queues and secrets.

> Nothing here has been run against the live accounts yet. The Supabase
> project `rvrpuapbeglqmcajsdgm` was **paused** at the last audit and must be
> resumed by the owner before any step touching the database.

## 0. Prerequisites (owner)

- Cloudflare account with the **Workers Paid** plan. Queues and the
  `[limits] cpu_ms` setting need it. This is a billing decision for the owner.
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

1. `backend/supabase/schema.sql` (base schema, RLS, signup trigger)
2. `backend/supabase/migrations/0002_credit_integrity.sql` (atomic credit
   ledger, balance ≥ 0, one active job per upload, free signup credits and
   a backfill for existing users)

Both files are idempotent, so re-running them is safe. CI runs them
(the migration applied twice) plus `supabase/tests/credit_integrity.test.sql`
against Postgres 16 on every push.

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
npx wrangler deploy --env staging            # vectorla-api-staging
npx wrangler deploy                          # vectorla-api (production)
```

CORS allows `https://vectorla.app`. If staging's frontend runs on another
origin, add it in `backend/src/api/cors.ts` first.

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

## Rollback

- Worker: `npx wrangler rollback` (per environment).
- Pages: promote the previous deployment in the dashboard.
- Database: the migration is additive (a constraint, indexes, a column,
  functions, a trigger body). To undo the signup grant, restore the
  `handle_new_user` body from `schema.sql`. Don't drop the ledger functions
  while a Worker that calls them is deployed.
