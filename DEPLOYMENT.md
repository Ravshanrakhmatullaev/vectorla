# Vectorla — Deployment Runbook

The frontend (`/`, Vite) deploys to **Cloudflare Pages**. The API (`backend/`)
deploys as a **Cloudflare Worker** with R2, Queues and a cron trigger, backed
by **Supabase** (Auth + Postgres). Staging and production are fully separate:
each has its own Worker, bucket, queues and secrets.

> **Status (2026-10-09):** staging is deployed on Cloudflare: API
> `https://vectorla-api-staging.ra-ravshan1998.workers.dev`, web
> `https://vectorla-web-staging.ra-ravshan1998.workers.dev`, database
> Supabase project `rvrpuapbeglqmcajsdgm` (active, migrations 0002–0004
> applied). All three Worker secrets are set, and the full end-to-end
> verification passed on 2026-10-09 ("Staging end-to-end verification"
> below). Nothing has been created for production.

## 0. Prerequisites (owner)

- Cloudflare account with the **Workers Paid** plan (a billing decision for
  the owner). Workers Free allows 10 ms of CPU per invocation, but tracing
  takes seconds, and `[limits] cpu_ms = 60000` is a Paid-only setting.
  Queues, the DLQ and cron triggers also work on Free (Queues: 10,000
  operations/day, 24 h retention), so CPU time is the only hard requirement.
  **Active since 2026-10-09:** Cloudflare accepted `cpu_ms = 60000` on the
  staging deploy.
- R2 enabled on the account (free tier: 10 GB-month storage, 1M Class A /
  10M Class B operations per month). Enabled 2026-10-09.
- Supabase project, resumed and reachable.
- `npx wrangler login` on the deploying machine, or `CLOUDFLARE_API_TOKEN` +
  `CLOUDFLARE_ACCOUNT_ID`. The token used for staging has Workers, R2 and
  Queues permissions but **not Cloudflare Pages**, which is why the staging
  frontend runs on Workers Static Assets (§5).

## 1. One-time resources

```bash
cd backend
# production
npx wrangler r2 bucket create vectorla-uploads
npx wrangler queues create vectorla-conversions
npx wrangler queues create vectorla-conversions-dlq
# staging (all three exist since 2026-10-09)
npx wrangler r2 bucket create vectorla-uploads-staging --location apac
npx wrangler queues create vectorla-conversions-staging
npx wrangler queues create vectorla-conversions-staging-dlq
```

The staging bucket uses the `apac` location hint, next to the Supabase
region (ap-northeast-2), because the queue consumer reads the original from
R2 and writes to Supabase in the same job. Without a hint, R2 picks the
region nearest to whoever runs the command. A bucket's location cannot be
changed later, so choose the production one deliberately.

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

**Staging (2026-10-09):** `SUPABASE_URL` (`https://rvrpuapbeglqmcajsdgm.supabase.co`)
and `DOWNLOAD_URL_SECRET` (64 random bytes from `openssl rand`, piped straight
into `wrangler secret put` and never shown) are set.
`SUPABASE_SERVICE_ROLE_KEY` was set by the owner as a Worker secret on
2026-10-09 (confirmed by name only; health then returned 200). Before that,
the Worker logged `Missing required backend secrets for staging:
SUPABASE_SERVICE_ROLE_KEY` and returned a generic 500, as designed.

Supplying the service-role key without exposing it (use the project's
existing key from Supabase Dashboard → Project Settings → API Keys; do not
rotate it). Pick one:

- **Owner's terminal:** `cd backend && npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY --env staging`.
  Wrangler prompts for the value with input hidden, so it never lands in
  shell history or a chat.
- **Cloudflare dashboard:** Workers & Pages → `vectorla-api-staging` →
  Settings → Variables and Secrets → Add → type **Secret**, name
  `SUPABASE_SERVICE_ROLE_KEY`. Later `wrangler deploy` runs keep it.
- **For an automated session:** store it as a secret environment variable
  named `SUPABASE_SERVICE_ROLE_KEY` in the Claude Code cloud environment's
  settings. A new session can then pipe it into
  `wrangler secret put SUPABASE_SERVICE_ROLE_KEY --env staging` without
  printing it, and run §6.

Never paste the key into a chat, an issue, a commit, or a command line
argument.

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
`https://` origins are accepted, with no wildcards. Staging is set to
`https://vectorla-web-staging.ra-ravshan1998.workers.dev` (§5).

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

**Staging frontend (Workers Static Assets).** The deploy token has no Pages
permission, so staging serves the same `dist/` from an assets-only Worker
(`wrangler.web-staging.toml`: `dist/_headers` applied, SPA fallback for
`/account`, `/privacy`, `/terms`). Production can still use Pages once a
token with Pages permission exists.

```bash
VITE_API_BASE_URL=https://vectorla-api-staging.ra-ravshan1998.workers.dev \
VITE_SUPABASE_URL=https://rvrpuapbeglqmcajsdgm.supabase.co \
VITE_SUPABASE_PUBLISHABLE_KEY=<publishable key> \
npm run build
backend/node_modules/.bin/wrangler deploy -c wrangler.web-staging.toml
```

The publishable key (`sb_publishable_…`, Dashboard → Project Settings → API
Keys) ships in the browser bundle by design; never use the service-role key
here.

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
3. [x] **Workers Paid plan** (`cpu_ms = 60000`), §0. Active since
       2026-10-09: the staging deploy was accepted and the Worker settings
       API reports `limits.cpu_ms = 60000` (on Free it failed with error
       100328).
4. [x] **Staging R2 bucket and queues** (§1): `vectorla-uploads-staging`
       (location hint `apac`), `vectorla-conversions-staging` and its DLQ.
       After the deploy the queue API lists `vectorla-api-staging` as producer
       and consumer (batch 1, 6 retries, DLQ `vectorla-conversions-staging-dlq`)
       and as the DLQ's consumer (batch 10).
       [x] Production (2026-10-10): `vectorla-uploads` (hint `apac`, empty),
       `vectorla-conversions`, `vectorla-conversions-dlq`. The production
       Worker attaches as producer and consumer when it is first deployed.
5. [x] **Worker secrets, staging** (§3): `SUPABASE_URL`,
       `SUPABASE_SERVICE_ROLE_KEY`, `DOWNLOAD_URL_SECRET`.
       [ ] Production: none set.
6. [x] **Per-IP rate limiter, staging:** bound (`API_RATE_LIMITER`,
       namespace 1002, 120 requests / 60 s). Verified: on one connection the
       123rd request got 429 with `Retry-After: 60`, and health stayed 200.
       Cloudflare counts per server within a location, so a client that opens
       a new connection per request was not limited (375 requests in 75 s all
       passed). It is a burst guard; the per-user limits are the enforcement.
       For a hard per-IP cap, add a WAF rate-limiting rule (needs approval).
       [x] Production: enabled in `wrangler.toml` (namespace 1001, 120 / 60 s);
       takes effect with the first production deploy.
7. [x] **R2 lifecycle rules, staging:** `expire-uploads` (`uploads/`, 35
       days) and `expire-conversions` (`conversions/`, 35 days), next to
       Cloudflare's default 7-day incomplete-multipart rule.
       [x] Production bucket (2026-10-10): the same two rules.
8. [x] **Frontend build variables, staging** (§5, Workers Static Assets).
       [ ] Production: `wrangler.web-production.toml` is ready (Workers Static
       Assets, see "Production preparation"); the build needs the production
       Supabase URL and publishable key.
9. [x] **Staging CORS:** `CORS_EXTRA_ORIGINS` is the staging web origin.
       Preflight from it returns `Access-Control-Allow-Origin`; other origins
       get none.
10. [ ] **Supabase Auth settings** (dashboard only, not reachable from the
        deploy tools): add `https://vectorla-web-staging.ra-ravshan1998.workers.dev`
        to the Site URL / redirect allowlist (the app sends
        `emailRedirectTo: window.location.origin`; an origin that is not on
        the list falls back to the Site URL). Email confirmation is on.
        Also set the SMTP sender and enable leaked-password protection
        (Supabase security advisor WARN).
11. [x] **Deploy staging and verify (§6):** every step passed on
        2026-10-09 ("Staging end-to-end verification" below).
        [ ] Production: deploy, then run §6 again.
12. [x] **Memory on Cloudflare** (staging, 2026-10-09): every worst-case
        upload completed in a real Cloudflare isolate. The largest peak was
        about 63 MB (16 px checkerboard); the 15.6 MB 16-bit PNG was about 57 MB.
        See "Memory on Cloudflare" below and BENCHMARKS.md.
        The real upload → queue path then ran the same worst-case files:
        every invocation finished `ok`, the most CPU was 9.9 s.

### Staging verification (2026-10-09)

Run against the deployed staging Workers and the staging Supabase project:

- Backend `npm run typecheck` and `npm test`: 37/37 smoke-test files pass.
  Frontend `npm run lint` and `npm run build` pass. Both Worker dry runs pass.
- Database (read-only): all 0002/0003/0004 objects present, 0 violations,
  `service_role` DML on all six tables, anon and authenticated none, RLS on
  everywhere. Migrations were not re-applied.
- API with the service-role key missing: every route, health included,
  returns a generic `500 INTERNAL_ERROR` with no secret names in the body.
  The log line names the missing secret. The cron fired on schedule
  (15:00 UTC) and stopped at the same check, as designed; it will fail every
  15 minutes until the key is set, without touching data.
- Web: `/`, `/account`, `/privacy` and `/terms` return 200 (SPA fallback);
  `/_headers` is not served. Security headers and the built CSP are present
  (`connect-src` lists only the staging API and Supabase origins), with
  `immutable` caching on `/assets/*` and revalidation on `/`.
- Real browser (Chromium): no CSP violations or page errors. Sign-in with
  an unknown account reaches Supabase Auth (400) and shows "Invalid login
  credentials". An upload reaches the API (500, fail-closed) and the UI shows
  the translated generic message. No horizontal overflow at 375 px.
- Supabase security advisor: RLS-without-policy (INFO, intended: only the
  Worker's service role reads these tables); `public.rls_auto_enable()`
  executable by anon/authenticated (WARN). That function is created by the
  Supabase platform (an `event_trigger` function, not in this repo), and
  Postgres refuses to call an event-trigger function directly, so the RPC is
  not usable. Leaked-password protection is off (item 10).

### Staging end-to-end verification (2026-10-09)

Run against the deployed staging Workers, queues, R2 bucket and Supabase
project with six throwaway accounts (tagged `vectorla_e2e = 2026-10-09`,
created directly in `auth.users` with bcrypt hashes, so no confirmation
e-mail was sent). Each signed in through Supabase Auth with the publishable
key. `wrangler tail` captured all 993 Worker events of the run: every
outcome `ok`, with no exception, `exceededMemory` or `exceededCpu`.

| Area | Result |
|---|---|
| Secret binding by name; API no longer fails closed | Pass: health 200, no token 401, forged token 401 |
| Signup credits (signup triggers on `auth.users` insert) | Pass: profile `free`, balance 10, one `credit` entry with `grant_key = signup` |
| Upload → queue → conversion → SVG download (PNG and JPEG) | Pass 21/21: job done in ~8 s; download is `image/svg+xml`, attachment, `no-store`, valid XML; list, detail and history endpoints |
| Debit and refund | Pass: Quick −1; Professional on the same upload refunds the Quick job (+1) and charges 2; the old result returns 404; the ledger reconciles |
| Insufficient credits | Pass: after balance 0, jobs fail "Not enough credits", no charge, never negative |
| Failed-job refund | Pass: corrupt PNG fails at once with the "could not be read" message (410, no charge). A charged job stuck in `processing` was failed and refunded once by the 16:00 cron. A charged job sent to the DLQ was failed and refunded once |
| Queue retry | Pass: a job whose lease was still held got a delayed retry; the redelivery logged "Taking over job" and completed it with one charge |
| Cron | Pass: 8 runs, all `ok`. Retention purged a 31-day-old upload, its job, conversion and both R2 objects. A fresh orphan in the swept shard was kept (24 h grace) |
| Upload size and format | Pass 13/13: free 5 MiB + 1 → 413, just under → 201; pro 15 MiB + 1 → 413, 15.6 MB 16-bit PNG → 201 and converted; 17 MB body → 413 with and without Content-Length; 30000² header and 4.2 MP → 413 before decoding; text-as-PNG and GIF → 415; duplicate name → 409; rejects cost nothing |
| Dense patterns, real queue | Pass: 16 px checkerboard keeps 31,249 paths; 8 px collapses to 1 path (known limitation) |
| Rate limits | Pass: free user's 3rd concurrent job → 429 `Retry-After: 30`; 21st upload in 10 min → 429 `Retry-After: 600`; other users unaffected; per-IP limiter see checklist item 6 |
| User isolation | Pass 17/17: another user's job, result, conversion, download (even with the owner's signed URL) and job creation → 403; lists empty; tampered, extended or missing signature → 401, past expiry → 410; no storage keys in any response |
| Browser EN/UZ/RU (Chromium) | Pass 30/30: language switch and `<html lang>`, UI sign-in, translated dialog and labels, upload, Quick and Professional SVG downloads, live balance with correct plurals, `/account`; no CSP, page or console errors |
| Real queue CPU and memory | Pass: 51 queue/DLQ invocations, max CPU 9.9 s (noisy 4 MP JPEG, Professional) of 60 s, max wall 16.7 s; none exceeded memory |

Findings, not defects: Cloudflare's browser check blocks the default
`Python-urllib` User-Agent (error 1010), so API clients need their own
User-Agent. Stage timings in the `[professional-trace]` log read 0 ms,
because the Workers clock does not advance during CPU work. The first cron
run with the key (15:30) purged the only pre-existing upload, from 2026-08-27,
under the 30-day retention.

**Cleanup.** Status 2026-10-10: still pending; the connector held the block
for approval again and timed out, so nothing was deleted. All 65 test objects were deleted from R2 (bucket empty), no
job is active, and the ledger matches every balance. The six test accounts
are banned (`banned_until = 2999-01-01`, sign-in returns `user_banned`). They
and their rows remain because the Supabase connector holds `DELETE` for an
interactive approval. To remove them, run
`backend/supabase/cleanup/2026-10-09_staging_e2e_users.sql` in the SQL
editor. It deletes only those six accounts and aborts without deleting
anything if any safety check fails. It was tested on Postgres 16 with the
repo schema (happy path plus five failing checks).

### Memory on Cloudflare (staging, 2026-10-09)

Method: a temporary, token-protected probe Worker
(`backend/scripts/memory-probe/`, deleted after the run) ran the
conversion's decode → analysis → trace calls (the same functions
`ConversionService` uses) in Cloudflare's runtime. Each request first held
N MB of extra memory (in 1 MB chunks); a binary search found the largest N
that still completed. With no image, Cloudflare stopped the isolate
(`exceededMemory`, error 1102) above 252–254 MB of extra memory, stable over
three runs. The trace's peak is that ceiling minus the ceiling with the trace
running (±3 MB):

| Upload | Mode | Peak on Cloudflare | CPU time |
|---|---|---:|---:|
| 4 MP PNG logo (0.1 MB) | Quick / Professional | ~43 / ~41 MB | 3.6 / 4.3 s |
| 2000² 16 px checkerboard | Professional | ~63 MB | 5.0 s |
| 2000² 8 px checkerboard | Professional | ~49 MB | 3.6 s |
| 4 MP noisy progressive 4:4:4 JPEG (3.7 MB) | Quick / Professional | ~33 / ~33 MB | 7.9 s (Pro) |
| 15.6 MB 16-bit 4 MP PNG (99% of the 15 MiB cap) | Quick / Professional | ~57 / ~57 MB | 5.8 / 7.2 s |

All ran with `outcome: ok`. The worst case leaves about 65 MB below the
documented 128 MB limit, and the CPU time is far below the 60 s limit.
Cloudflare enforced at about twice the documented limit here; the 128 MB
figure stays the design budget. These numbers cover the decode and trace,
not the Supabase client or R2 transfer.

### Production preparation (2026-10-10)

Nothing is deployed to production, and no DNS record or `vectorla.app` route
was changed.

**Ready**

- R2 `vectorla-uploads` (location hint `apac`, the staging database's region;
  still empty, so it can be recreated in another region if the production
  database goes elsewhere) with `expire-uploads` / `expire-conversions`
  (35 days) and Cloudflare's 7-day multipart rule.
- Queues `vectorla-conversions` and `vectorla-conversions-dlq`.
- `wrangler.toml` (production): rate limiter enabled (namespace 1001),
  `cpu_ms = 60000`, cron, queue consumer with DLQ. `wrangler deploy --dry-run
  --env=""` binds `vectorla-conversions`, `vectorla-uploads` and
  `API_RATE_LIMITER`, with `ENVIRONMENT=production`. Workers Paid covers it.
- Database bootstrap, verified on Postgres 16 in the production order:
  preflight on the empty database → `schema.sql` → `0002` → preflight
  (0 failing checks, `service_role` DML, anon/authenticated none, RLS on) →
  `0003` → `0004` → a second run of 0002–0004 (no-op) → the credit-integrity,
  usage-limit and hardening tests pass.
- Frontend: `wrangler.web-production.toml` (`vectorla-web`, SPA fallback,
  `_headers` applied); its dry run passes.
- The `vectorla.app` zone is active on this Cloudflare account, so custom
  domains need no registrar change.

**Blocked: a production Supabase project needs a paid plan (owner
decision).** The organization is on the Free plan with its two active
projects (`Vectorla` = staging, `poligrafiya`), the Free limit, and Free
projects pause after a week of inactivity. Options: upgrade the organization
to Pro and create `vectorla-production`, or pause `poligrafiya` (not
recommended: Free projects still auto-pause). Then, in order: run the
bootstrap above in its SQL editor; set the Worker secrets; set the Auth
settings below; build and deploy.

**Worker secrets for production** (`--env=""`, after the project exists):
`SUPABASE_URL` (its API URL), `SUPABASE_SERVICE_ROLE_KEY` (entered by the
owner at the hidden `wrangler secret put` prompt or in the dashboard, §3),
and `DOWNLOAD_URL_SECRET`, generated fresh and different from staging:
`openssl rand -base64 48 | tr -d '\n' | npx wrangler secret put DOWNLOAD_URL_SECRET --env=""`.
The Worker fails closed until all three exist.

**Production hostnames (at launch, needs the owner's DNS go-ahead).**
Web on `vectorla.app` and `www.vectorla.app`, API on `api.vectorla.app`, as
Worker custom domains (the commented `routes` lines in
`wrangler.web-production.toml` and `backend/wrangler.toml`). CORS already
allows both web origins, so `CORS_EXTRA_ORIGINS` stays empty in production.
Build the frontend with `VITE_API_BASE_URL=https://api.vectorla.app`, which
also sets the CSP `connect-src`.

**Supabase Auth settings (dashboard → Authentication → URL Configuration).**

| Setting | Production | Staging |
|---|---|---|
| Site URL | `https://vectorla.app` | `https://vectorla-web-staging.ra-ravshan1998.workers.dev` |
| Redirect URLs | `https://vectorla.app`, `https://www.vectorla.app` | the staging web origin |

The app passes `emailRedirectTo` / `redirectTo` =
`window.location.origin` (`src/lib/auth.tsx`), so the exact origins are
enough; any other origin falls back to the Site URL. Keep email
confirmation on. On Pro, enable leaked-password protection and set a
minimum password length.

**SMTP requirements.** Supabase's built-in email only sends to the
organization's team members, at about 2 messages an hour, so public signup
and password reset need custom SMTP before launch:

- A provider account (Resend, Postmark, Amazon SES, Brevo or similar;
  most have a free tier). Choosing one is the owner's decision.
- Sender `no-reply@vectorla.app`, name "Vectorla". The provider gives SPF,
  DKIM and DMARC records for `vectorla.app` (a DNS change, at launch).
- Dashboard → Authentication → SMTP Settings: host, port (465 or 587),
  username, password (entered by the owner; never in the repository).
- Raise the Auth email rate limit after enabling custom SMTP, and review
  the confirm-signup and reset-password templates (one template per type,
  so write them in all three languages or in the primary market language).

**Frontend: Workers Static Assets, not Pages (recommendation).** The same
`dist/` and `_headers` passed the staging verification on Workers Static
Assets, including the CSP, SPA routes and EN/UZ/RU flows. The current token
can deploy it (it has no Pages permission). It uses the same `wrangler`
deploy and rollback as the API, takes custom domains directly, and Cloudflare
recommends Workers for new projects. Pages would add Git-connected preview
deployments, which `wrangler versions upload` preview URLs also cover.

**Final production deploy (after the blockers):**

1. Bootstrap the production database; set the three Worker secrets.
2. `cd backend && npx wrangler deploy --env=""` (API).
3. Build with the production values; `wrangler deploy -c wrangler.web-production.toml`.
4. Owner-approved: enable the custom-domain `routes` and redeploy both.
5. Set the Auth URLs and SMTP; run every step in §6 against production.

### Known limitations (accepted for launch, tracked in ROADMAP.md)

- Checkerboard-like patterns with more than 40,000 regions (e.g. 8 px squares
  at 2000²) are still simplified into a few shapes, to keep memory bounded.
- `style-src` keeps `'unsafe-inline'` (React inline styles).
- The per-IP limiter counts per Cloudflare server, so it is a burst guard
  rather than a hard per-IP cap (checklist item 6).
- The public signup e-mail (confirmation link) was not exercised on staging:
  Auth URL and SMTP settings are dashboard items (checklist item 10).
