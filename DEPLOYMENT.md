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
4. `backend/supabase/migrations/0003_usage_limits.sql` (indexes for the
   upload rate limits, the concurrency limit and the orphan sweep, plus
   `user_stored_bytes()`, which sums a user's stored bytes for the storage
   quota). It adds only indexes and one read-only function, and changes no
   data. Until it is applied, the Worker still enforces the quota by paging
   the rows, which is slower but correct.
5. `backend/supabase/migrations/0004_revoke_handle_new_user_rpc.sql`
   (removes `handle_new_user()` from the Data API; Supabase security advisor
   lints 0028/0029). Signup is unaffected.

If a migration tool hangs on the `create trigger ... on auth.users`
statement in 0002 (seen with the Supabase MCP `apply_migration` call on
2026-10-08), run that statement on its own in the SQL editor: it completes
at once there.

Both files are idempotent, and the order is robust. Re-running `schema.sql`
after 0002 keeps the signup grant, because it lives in its own trigger
(`on_auth_user_created_grant_credits`) rather than in `handle_new_user`.
CI runs the stubs, schema, each migration twice,
`supabase/tests/credit_integrity.test.sql`,
`supabase/tests/usage_limits.test.sql` and
`supabase/tests/hardening_0004.test.sql` against Postgres 16 on every push. The tests cover ledger invariants, anon denial, and a full Worker
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

### Abuse limits

These are enforced in code with no configuration (`PLAN_LIMITS`,
`backend/src/config/index.ts`; `UsageLimitsService`). A breach returns
**429** with `Retry-After`.

| Limit | Free | Starter | Pro | Business |
|---|---:|---:|---:|---:|
| Uploads per 10 min | 20 | 60 | 60 | 120 |
| Uploads per day | 100 | 600 | 1,000 | 3,000 |
| Stored originals | 250 MB | 2 GB | 10 GB | 50 GB |
| Active (queued/processing) jobs | 2 | 4 | 6 | 10 |
| File size | 5 MB | 15 MB | 15 MB | 15 MB |

The upload body is counted as it streams. A request is cut off at 16 MB
(the 15 MB file plus multipart overhead) even when it has no, or a false,
`Content-Length`.

**Per-IP request limit (🧑 requires owner approval: it adds a binding to
the production Worker).** `wrangler.toml` contains a commented
`[[ratelimits]]` block (`API_RATE_LIMITER`, 120 requests per 60 s per
`CF-Connecting-IP`), with a separate namespace for staging. To enable it,
uncomment both blocks, run `npx wrangler deploy --dry-run`, and check that
the output lists `env.API_RATE_LIMITER (120 requests/60s)`. Without the
binding, the code skips this check; if the binding errors, the request is
allowed (fail open), so a Cloudflare problem cannot lock users out. Health
checks and CORS preflights are never limited. As a further layer, a
Cloudflare WAF rate-limiting rule on `/api/v1/uploads` can be added in the
dashboard (also needs approval).

### Data retention (stated in the Privacy Policy)

- The 15-minute cron deletes uploads and their results 30 days after upload
  (`UPLOAD_RETENTION_DAYS`, `backend/src/services/RetentionService.ts`).
- The same cron deletes **orphaned files** (an R2 object with no database
  row, e.g. an original whose upload row failed): one of 32 key shards per
  run, so the whole bucket is checked every 8 hours; objects younger than
  24 hours are never touched (`OrphanSweeper`,
  `backend/src/services/OrphanCleanupService.ts`). Originals whose upload row
  fails, and results of failed jobs, are deleted immediately.
- **R2 lifecycle rule (backstop, 🧑 requires owner approval — it changes the
  production bucket).** Expire anything the cron somehow missed 5 days after
  the 30-day retention:

  ```sh
  wrangler r2 bucket lifecycle add vectorla-uploads expire-uploads uploads/ --expire-days 35
  wrangler r2 bucket lifecycle add vectorla-uploads expire-conversions conversions/ --expire-days 35
  wrangler r2 bucket lifecycle list vectorla-uploads   # verify
  # staging: the same three commands with vectorla-uploads-staging
  ```

  The rule acts on an object's upload time, like the cron, so it never
  deletes a file the Privacy Policy says is still kept.
- Request logs must be kept for **no longer than 30 days**. Cloudflare's own
  Workers log retention is shorter than that. Do not add a log drain or
  observability setting that keeps logs longer without updating the Privacy
  Policy first.

## 5. Deploy the frontend (Cloudflare Pages)

- Build command: `npm run build` · output: `dist`
- Environment variables (per Pages environment):
  - `VITE_API_BASE_URL`: the Worker URL for that environment
  - `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`: publishable key
    only, never the service-role key
- `public/_headers` is a template. The build (`scripts/securityHeaders.ts`)
  writes `dist/_headers` with `connect-src` set to exactly the origins of
  `VITE_API_BASE_URL` and `VITE_SUPABASE_URL` (no wildcards), and `script-src`
  allowing the inline theme script by its SHA-256 hash (no `'unsafe-inline'`).
  A production build without `VITE_API_BASE_URL`, or with a non-https URL,
  fails. Changing the API or Supabase host therefore needs a rebuild.
  `style-src` keeps `'unsafe-inline'` (React inline styles).

## 6. Verify after each deploy

1. `GET <api>/api/v1/health` returns `{"status":"ok","environment":"<env>"}`.
2. Sign up a new user. `GET /api/v1/credits` shows **10**.
3. Upload a PNG logo. The job completes, the SVG downloads, and the balance is **9**.
4. Upload a JPEG and run a Professional trace. The job completes and the balance drops by **2**.
5. Upload an oversized image (e.g. a PNG header claiming 30000×30000). It is
   rejected with **413** before decoding. A 16 MB file is rejected with
   **413**, and the browser shows the translated "too large" message.
6. Start 21 uploads within 10 minutes as a free user. The 21st returns
   **429** with `Retry-After`, and the browser shows the translated
   rate-limit message, never the raw server text.
7. In the browser devtools, check that the response `Content-Security-Policy`
   `connect-src` lists only `'self'`, the API origin and the Supabase origin.
8. `npx wrangler tail` shows no errors, and the cron sweeper runs every 15 minutes
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

## Production launch checklist

Status at commit time on branch `claude/bold-newton-y6wsui`. **✅ code** means
it is done in this repository and verified by tests. **🧑 approval** means it
is a change to a live account, which nobody has made; each needs the owner's
go-ahead.

### Done in code (✅)

- [x] Upload limits: 15 MB file cap, enforced on the streamed bytes (with no,
      or a false, `Content-Length`); 413 before decoding for oversized
      dimensions.
- [x] Abuse limits: per-user upload rate (10 min / day), storage quota,
      active-job limit, all 429 with `Retry-After`; optional per-IP limiter
      (fails open).
- [x] Orphan cleanup: immediate deletion of files whose row fails, failed
      jobs' partial results, and a sharded 24 h-grace sweep every 15 minutes.
- [x] CSP `connect-src` built from the configured API/Supabase origins;
      inline script allowed by hash; `object-src 'none'`; HSTS.
- [x] Users see only fixed, translated error messages (EN/UZ/RU); raw errors
      are logged only.
- [x] Billing: Professional 2 credits, 1 when it falls back to the basic
      tracer; charged once per job after tracing; concurrent jobs never
      overdraw; concurrent failure handlers refund once.
- [x] Memory: allocation failure fails the job at once (no retry loop),
      refunded, "too complex" message. Dense patterns up to 40,000 regions are
      kept, within a 68 MB tested budget.
- [x] Tests: backend smoke suite, Postgres 16 credit and usage-limit tests,
      the 80-image benchmark (0 regressions), frontend lint and build, and the
      local end-to-end browser runs.

### Needs owner approval (🧑): Cloudflare and Supabase

1. [x] **Resume the Supabase project** (`rvrpuapbeglqmcajsdgm`): active
       since 2026-10-08. It is the only Vectorla project and serves as
       staging; production needs its own project.
2. [x] **Staging database (2026-10-08):** preflight clean (0 violations,
       service_role DML, anon/authenticated none, RLS on all six tables);
       schema already matched `schema.sql`; 0002, 0003 and 0004 applied;
       re-check passed 19/19, and a rolled-back live ledger test passed
       (signup grant, debit, idempotent debit, single refund, overdraw
       refused, stored bytes, one active job per upload).
       [ ] Production database: the same steps on the production project.
3. [ ] **Workers Paid plan** (`cpu_ms = 60000`), §0. **Checked 2026-10-09: the
       account is on Workers Free.** Cloudflare rejects `limits.cpu_ms` with
       error 100328 ("CPU limits are not supported for the Free plan"), so no
       Worker with this `wrangler.toml` can be deployed until the plan is
       upgraded (owner's billing decision).
4. [ ] **R2 buckets and queues** (§1). Staging queues `vectorla-conversions-staging`
       and `vectorla-conversions-staging-dlq` exist (created 2026-10-09).
       **R2 is not enabled on the account** (the API answers "Please enable R2
       through the Cloudflare Dashboard"), so neither bucket exists. Enabling
       R2 is a dashboard action that may ask for a payment method. Nothing is
       created for production.
5. [ ] **Worker secrets** (§3): `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
       `DOWNLOAD_URL_SECRET` per environment. Never commit them.
6. [ ] **Per-IP rate limiter:** enabled for staging in `wrangler.toml`
       (`[[env.staging.ratelimits]]`, namespace 1002). For production,
       uncomment the top-level `[[ratelimits]]` block at release time.
7. [ ] **R2 lifecycle rules:** 35-day expiry on `uploads/` and `conversions/`
       for both buckets (Data retention, above).
8. [ ] **Pages environment variables** (§5): `VITE_API_BASE_URL`,
       `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`. The production
       build fails without the API URL.
9. [ ] **Staging CORS:** `CORS_EXTRA_ORIGINS` set to the staging Pages origin.
10. [ ] **Supabase Auth URLs**, email confirmation and SMTP (§2).
11. [ ] **Deploy staging**, run every step in §6, then deploy production and
        run them again.
12. [ ] **Memory on Cloudflare:** run a 15 MB, 16-bit PNG and a dense pattern
        on staging, and watch `wrangler tail` for "exceeded memory". The
        measurements so far are from local workerd (about 88 MB peak against
        a 128 MB isolate).

### Known limitations (accepted for launch, tracked in ROADMAP.md)

- Checkerboard-like patterns with more than 40,000 regions (e.g. 8 px squares
  at 2000²) are still simplified into a few shapes, to keep memory bounded.
- `style-src` keeps `'unsafe-inline'` (React inline styles).
- Memory figures come from local workerd, not from Cloudflare's production
  runtime.
