# Vectorla - browser image-to-vector platform

Vectorla is a full-stack image-to-vector application for designers, print
shops, advertising agencies, CNC/laser users, sticker makers, and branding
teams. It combines a React marketing/workspace frontend with a separately
deployable Cloudflare Worker API.

The current product can upload PNG, JPEG, and WebP images, analyze them,
queue tracing jobs, generate SVG results with ImageTracer or Potrace, poll job
status, preview/download completed results, enforce credits, and expose
authenticated conversion, credit, and history APIs. It is an active
pre-production implementation, not a finished commercial service: production
billing, non-SVG generation, and several product workflows remain.

## Current status

### Completed

- Responsive React 19 landing page and workspace UI with English, Uzbek, and
  Russian translations, persisted light/dark themes, SEO/PWA assets, error
  boundaries, and below-the-fold code splitting.
- Workspace upload flow when `VITE_API_BASE_URL` is configured: upload ->
  automatic queued job -> polling -> real SVG preview/download.
- Honest Preview Mode when no backend URL is configured; files are not sent or
  processed in that mode.
- Quick Trace using real bitmap tracing and Professional Trace using noise
  reduction, background cleanup, contrast normalization, color quantization,
  edge enhancement, provider selection, and SVG optimization.
- Image analysis for dimensions, color/transparency/grayscale signals,
  complexity, image classification, preset/provider recommendation, and rough
  quality/credit/time estimates.
- Cloudflare Worker API v1 with standardized envelopes, request IDs, response
  timing, structured request logs, CORS, OpenAPI output, and a health route.
- R2-backed uploads and result storage, Cloudflare Queue job processing, and
  Supabase-backed repositories with shared in-memory fallbacks for local tests.
- Supabase JWT verification on protected backend routes, ownership checks,
  signed download URLs, upload signature validation, randomized storage keys,
  duplicate-job protection, queue idempotency, and optimistic locking.
- Supabase email/password signup, login, logout, persistent/refreshing browser
  sessions, password recovery, and bearer-token API requests.
- Auth-user profile provisioning, deny-by-default RLS, profile-derived upload
  limits, and development-only test identity/credit escape hatches.
- Credit calculation, enforcement, debits/refunds, current-balance/recent-
  transaction API, and paginated user history API.
- Twenty-three standalone backend smoke-test files plus a synthetic vector
  quality harness and report.

### Partial

- The workspace is connected to the API; the Hero upload card and primary
  marketing CTAs are still illustrative.
- ImageTracer and Potrace are implemented. Photo analysis may recommend the
  unimplemented Vision provider, in which case conversion safely falls back
  to ImageTracer. The OpenAI provider is also a stub.
- The domain model lists SVG, PNG, PDF, EPS, and DXF, but the current tracing
  pipeline produces SVG only.
- Credits and profile-derived plan limits are enforced, but monthly grants/
  top-ups are not connected to accounts or billing.
- The frontend pricing section still shows the older three-plan model; backend
  limits use Free, Starter, Pro, and Business credit tiers.
- Orphan detection exists, but cleanup is not scheduled and storage deletion
  is not implemented.

### Not implemented

- Stripe checkout, subscriptions, billing-cycle credit grants, and paid
  top-ups.
- Batch uploads/conversions and archive downloads.
- PDF, EPS, DXF, and PNG result generation; print-ready CMYK/cut-line handling.
- `GET /api/v1/uploads/:id` and `DELETE /api/v1/uploads/:id`.
- Real Vision/OpenAI vectorization and real AI upscaling.
- Analytics, error tracking, CI, legal pages, and confirmed production/domain
  deployment from repository evidence.

## Architecture

```text
Browser (React/Vite)
  -> Cloudflare Worker API v1
      -> Supabase Auth + Postgres repositories
      -> R2 upload/result storage
      -> Cloudflare Queue consumer
          -> image analysis
          -> ImageTracer or Potrace
          -> SVG storage + credit debit
```

The frontend and backend are independent packages and deployables:

```text
src/                         React frontend
  components/                Marketing and workspace UI
  hooks/useUploadFlow.ts      Upload, job creation, polling, retry/reset
  lib/api/                    Typed API client and download helpers
  data/i18n.ts                EN/UZ/RU copy and typed translation contracts

backend/
  src/index.ts                Worker fetch router and queue consumer
  src/routes/                 API v1 handlers
  src/services/               Auth, upload, jobs, conversion, credits, history
  src/providers/              ImageTracer, Potrace, and provider interfaces
  src/pipeline/               Quick/Professional trace pipelines
  src/repositories/           Supabase and in-memory implementations
  src/qualityTesting/         Synthetic quality harness and metrics
  supabase/schema.sql         Postgres schema
  API.md                      Human-readable API reference
  QUALITY_REPORT.md           Tracing quality findings
```

## Local development

### Frontend

```bash
npm install
cp .env.example .env.local
npm run dev
```

Set `VITE_API_BASE_URL` to the Worker origin to enable the real workspace
flow, and set `VITE_SUPABASE_URL` plus `VITE_SUPABASE_PUBLISHABLE_KEY` to
enable signup/login and authenticated API calls. Leave the API URL empty to
use Preview Mode.

### Backend

```bash
cd backend
npm install
cp .dev.vars.example .dev.vars
npm run dev
```

For a real Supabase-backed environment, apply `backend/supabase/schema.sql`
and fill `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and
`DOWNLOAD_URL_SECRET`. Without Supabase credentials, repositories fall back
to process-local in-memory storage only in development. Staging and production
fail closed when required secrets are missing. Local development also
auto-funds credit shortfalls and relaxes duplicate-filename friction.

## Verification

Frontend:

```bash
npm run build
npm run lint
```

Backend type-check:

```bash
cd backend
npm run typecheck
```

Backend smoke tests are plain `tsx` scripts. Run one directly, for example:

```bash
cd backend
npx tsx src/routes/history.smoke-test.ts
```

The repository currently contains 23 `*.smoke-test.ts` files. There is no
single test script or CI workflow yet.

## API and deployment

- API base path: `/api/v1`
- Human reference: `backend/API.md`
- Machine-readable spec: `GET /api/v1/openapi.json`
- Frontend target: Cloudflare Pages (`npm run build`, output `dist`)
- Backend target: Cloudflare Workers (`cd backend && npm run deploy`)
- Worker bindings: R2 bucket `UPLOADS_BUCKET` and queue
  `CONVERSION_QUEUE`; Supabase credentials and download signing key are
  Worker secrets.

Repository configuration describes the deployment targets, but does not by
itself prove that `vectorla.app`, the Worker, R2, Queue, or Supabase resources
are live in production.
