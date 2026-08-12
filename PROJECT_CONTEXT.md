# Vectorla - Project Context

## Project vision

Vectorla is `vectorla.app`, a browser-based raster-to-vector platform for
designers, print shops, advertising agencies, CNC/laser users, sticker
makers, and branding companies. The target is clean production-oriented
vector output rather than decorative web-only SVGs.

## Source-of-truth status

This repository is now full-stack:

- `src/` is a React/Vite marketing site and interactive workspace.
- `backend/` is a separately packaged Cloudflare Worker with R2, Queue, and
  Supabase integration.
- The workspace can perform a real upload -> analysis -> queued trace -> poll
  -> SVG preview/download flow when `VITE_API_BASE_URL` is configured.
- With no backend URL, the workspace deliberately falls back to visibly
  disclosed Preview Mode and does not read or upload the selected file.

The product is pre-production. Core tracing and API foundations work, while
production auth UX, billing, multi-format export, batch workflows, and launch
operations remain incomplete.

## Tech stack

### Frontend

- React 19 and React DOM 19
- TypeScript with strict mode, `noUncheckedIndexedAccess`, and
  `noImplicitOverride`
- Vite 8 with `@` -> `src/`
- Tailwind CSS v4 using CSS-first `@theme` configuration
- Framer Motion and Lucide React
- Hand-built theme and i18n contexts; no external i18n package
- oxlint

### Backend

- Cloudflare Worker in ES module format
- Cloudflare R2 for uploaded rasters and generated results
- Cloudflare Queues for conversion jobs
- Supabase Auth verification and Postgres repositories through
  `@supabase/supabase-js`
- In-memory repository fallbacks keyed by `Env` identity for local tests
- ImageTracer.js, `@cadit-app/potrace-ts`, and jSquash PNG/JPEG/WebP WASM
  decoders
- Standalone TypeScript package under `backend/`; root build/lint scripts do
  not include it

## Completed implementation

### Frontend foundation

- Landing page sections: Hero, compatibility strip, workspace, features, use
  cases, pricing, FAQ, navbar, and footer.
- Responsive navigation, mobile menu, accessible comparison sliders, and
  light/dark themes with pre-mount FOUC prevention.
- English, Uzbek, and Russian translations persisted under `vectorla-lang`.
- Theme persistence under `vectorla-theme`.
- Error boundary/fallback components and lazy-loaded below-the-fold sections.
- SEO metadata, canonical/social preview metadata, sitemap, robots file, PWA
  manifest/icons, Cloudflare Pages security/cache headers.
- Shared single-artwork before/after presentation; CSS reveals filtered and
  crisp renderings of the same composition rather than two unrelated images.

### Real workspace flow

- `src/hooks/useUploadFlow.ts` owns upload state, Quick/Professional mode,
  polling, retry, reset, and superseding-job behavior.
- `src/lib/api/` implements typed envelope parsing, form/JSON requests,
  no-store polling, development retry behavior, and authenticated raw result
  downloads.
- `WorkspacePreview` supports file input/drop, original preview, real analysis
  display, job status, classified failure states, trace-mode switching,
  vector result fetch, comparison, and browser download.
- Quick Trace uses the automatically created upload job. Professional Trace
  creates a replacement job with the `professional` preset and refunds a
  completed superseded job so switching modes does not stack charges.

### API platform

- All application routes are under `/api/v1`.
- Standard success/error/paginated envelopes with a fixed error-code
  vocabulary.
- Per-request UUID, `X-Request-Id`, `X-Response-Time`, structured JSON logs,
  and centralized CORS.
- Public `GET /api/v1/health` and `GET /api/v1/openapi.json`.
- Protected routes authenticate through Supabase `auth.getUser(token)`.
- Non-production-only `X-Test-User-Id` bypass for smoke tests/local Vite; it
  is ignored in production and never overrides a real bearer token.

### Uploads, jobs, and storage

- `POST /api/v1/uploads` accepts PNG/JPEG/WebP multipart uploads, validates
  filename, MIME type, extension, size, content signature, emptiness, and
  duplicate filenames, then stores bytes in R2 and metadata in a repository.
- Storage keys exclude the caller-supplied filename and use randomized IDs.
- Every successful upload automatically creates and enqueues a job.
- `POST /api/v1/jobs` supports reprocessing, presets/settings, active-job
  deduplication, and `supersedesJobId` refunds.
- `GET /api/v1/jobs/:id` and `GET /api/v1/jobs/:id/conversion` expose
  ownership-checked status/results with no-store responses.
- Queue processing is idempotent around job transitions and uses Cloudflare
  retry behavior on failures.
- Completed conversion metadata never exposes raw R2 `storageKey` values.
- Signed, expiring, ownership-checked `GET /api/v1/download` streams result
  bytes from R2 with `Cache-Control: no-store`.

### Vectorization and quality

- Shared PNG/JPEG/WebP decode path through jSquash WASM modules.
- Image analysis reports dimensions, aspect ratio, colors, transparency,
  grayscale, edge/noise signals, image type, complexity, recommended provider
  and preset, estimated quality, credits, and processing time.
- The historically named `PlaceholderProvider` is a real ImageTracer engine
  with tuned presets for logo, signature, QR, icon, sticker, blueprint,
  sketch, illustration, and photo-like inputs.
- `PotraceProvider` is implemented for monochrome logos, signatures, QR
  codes, stamps, and simple icons.
- Quick Trace skips image-domain preprocessing but still selects a provider
  and optimizes SVG.
- Professional Trace runs noise reduction, background cleanup, contrast
  normalization, color quantization, edge enhancement, provider selection,
  and SVG optimization. Its auto-upscale stage is intentionally disabled
  because real upscaling is not implemented.
- Provider failures caused by the unimplemented Vision/OpenAI paths fall back
  to the working ImageTracer engine during normal conversion.
- Synthetic quality harness, SVG metrics, tuned preset smoke tests, and
  `backend/QUALITY_REPORT.md` document measured quality work.

### Retrieval, credits, and history

- `GET /api/v1/conversions` provides a paginated caller-scoped list.
- `GET /api/v1/conversions/:id` provides ownership-checked metadata and a
  fresh signed download URL.
- Credit balances and transactions use optimistic locking to avoid lost
  concurrent updates.
- Conversions enforce credits, record debits, and support idempotent refunds
  when completed jobs are superseded.
- `GET /api/v1/credits` returns the authenticated user's current balance and
  bounded recent transactions with no-store caching.
- `GET /api/v1/history` derives a stable, paginated, caller-only job history
  with associated conversion IDs, using bounded job and conversion queries
  and no-store caching.
- A development-only credit grant endpoint exists and returns 404 in
  production.
- Orphan detection compares R2 objects against upload/conversion records.

### Persistence and integrity

- Supabase repositories exist for uploads, jobs, conversions, and credits.
- In-memory equivalents support local smoke tests without credentials.
- Database schema includes relevant ownership/look-up indexes, duplicate
  upload protection, optimistic-lock versions, and unique conversion storage
  keys.
- Active-job checks, completed-job idempotency, and conflict handling reduce
  duplicate queue work and double billing.

## Partially implemented

### Authentication

The backend's production authentication and authorization checks are real.
The frontend does not yet provide login, signup, token storage, or bearer-token
injection. Its only automatic identity is the Vite-development test header,
which production Workers reject. Therefore a production frontend cannot yet
use protected API routes without completing the frontend auth/session flow.

### Vectorization providers

ImageTracer and Potrace work. `VisionProvider` and `OpenAIProvider` still
throw `NotImplementedError`. Photo analysis recommends Vision, but the
conversion service catches that expected gap and falls back to ImageTracer.

### Export and print-ready model

Types/configuration describe SVG, PNG, PDF, EPS, and DXF and the marketing UI
shows several formats. The actual conversion engine currently emits SVG only.
Job records do not yet carry requested output-format count or print-ready
flags, so credit calculation is invoked as one format/non-print-ready.

### Credits and plans

Backend plan configuration has four tiers:

| Plan | Monthly credits | Max file | Batch limit | Configured formats |
|---|---:|---:|---:|---|
| Free | 10 | 5 MB | 1 | SVG, PNG |
| Starter | 100 | 25 MB | 10 | SVG, PNG, PDF |
| Pro | 500 | 100 MB | 100 | SVG, PDF, EPS, DXF, PNG |
| Business | 5,000 | 500 MB | 1,000 | SVG, PDF, EPS, DXF, PNG |

These are configuration limits, not proof that batch/multi-format generation
exists. The frontend pricing section is still the older Free/Pro/Business
copy and includes claims that do not match the credit model. Upload callers
currently submit their plan; it is not derived from an authenticated profile
or billing subscription. Monthly grants exist as a service method but are not
wired to a billing cycle.

### Frontend integration

The workspace is connected when `VITE_API_BASE_URL` is present. The Hero
dropzone, Hero CTA buttons, navbar sign-in/start buttons, pricing CTAs, API
navigation destination, and footer legal links are not functional product
flows yet.

### Cleanup and operations

Orphan detection works, but there is no scheduled trigger or deletion pass.
`StorageService.deleteFile`, `UploadService.getUpload`, and
`UploadService.deleteUpload` are not implemented. The health endpoint is a
liveness check only; it does not probe R2, Queue, or Supabase dependencies.

## Not yet implemented

- Production frontend auth/account UI and session integration.
- Stripe billing, checkout/customer portal, subscription webhooks, monthly
  credit scheduling, and paid top-ups.
- Batch upload/processing and archive download.
- PNG/PDF/EPS/DXF generation and real multi-format billing.
- Print-ready CMYK validation, cut-line generation, and plan waiver behavior.
- Upload GET/DELETE API routes and storage deletion.
- Real Vision/OpenAI tracing and real AI upscaling.
- User-facing credits/history/account screens; the backend APIs exist, but
  the landing-page frontend does not consume them.
- Analytics and production error tracking despite env placeholders.
- Privacy Policy and Terms pages.
- CI workflow and an aggregate backend test script.
- Confirmed production deployment/domain/binding state from repository
  evidence.

## API inventory

Public:

- `GET /api/v1/health`
- `GET /api/v1/openapi.json`

Authenticated:

- `POST /api/v1/uploads`
- `POST /api/v1/jobs`
- `GET /api/v1/jobs/:id`
- `GET /api/v1/jobs/:id/conversion`
- `GET /api/v1/conversions`
- `GET /api/v1/conversions/:id`
- `GET /api/v1/download?key=&exp=&sig=`
- `GET /api/v1/credits`
- `GET /api/v1/history`

Development only:

- `POST /api/v1/dev/credits/grant`

Not implemented:

- `GET /api/v1/uploads/:id`
- `DELETE /api/v1/uploads/:id`

See `backend/API.md` and the served OpenAPI document for response contracts.

## Testing status

- Root `npm run build` runs strict TypeScript project builds and Vite.
- Root `npm run lint` runs oxlint.
- `cd backend && npm run typecheck` runs backend TypeScript without emit.
- There are 23 standalone `*.smoke-test.ts` files covering fetch routing,
  queue behavior, auth, uploads, jobs, conversion retrieval/download,
  credits, history, repositories/services, providers, analysis, professional
  tracing, and quality presets.
- Tests call real handlers/services with fake Cloudflare bindings and
  in-memory repositories; no real Supabase project is required.
- There is no conventional unit-test runner configuration or CI workflow.

## Deployment context

- Frontend target: Cloudflare Pages, build `npm run build`, output `dist`.
- Backend target: Cloudflare Workers through `backend/wrangler.toml`.
- Required Worker resources: R2 bucket `vectorla-uploads`, queue
  `vectorla-conversions`, Supabase URL/service-role secret, and download URL
  signing secret.
- CORS always allows `https://vectorla.app`; localhost origins are allowed
  outside production only.
- Repository files describe intended deployment. Do not claim the domain,
  Worker, R2 bucket, Queue, or Supabase project is live without external
  verification.
- Cloudflare Pages CSP currently uses `connect-src 'self'`; a separately
  hosted API origin will require the deployed header policy to allow that
  Worker origin.

## Development rules

1. Read this file, the relevant README/API docs, and the affected code before
   changes. Live code is the source of truth when comments/docs disagree.
2. Keep strict TypeScript settings. Fix type issues; do not weaken compiler
   flags or add `any`/`ts-ignore` escapes.
3. Put every visible UI string in all three language records in
   `src/data/i18n.ts`; keep structural data separate in `src/data/`.
4. Keep the hand-built theme/i18n contexts and `src/utils/cn.ts` unless a task
   explicitly requests an architectural change.
5. Preserve honest Preview Mode. Do not simulate backend processing when no
   backend is configured.
6. Never expose raw storage keys or weaken ownership/auth checks.
7. Treat both frontend `npm run build`/`npm run lint` and backend
   `npm run typecheck` plus relevant smoke tests as required verification.
8. For UI work, check light/dark themes and approximately 375px/1280px
   viewports.
9. Do not add dependencies until the existing stack has been checked.
10. Do not commit or push unless explicitly asked in that turn.

## Current priorities

1. Complete production frontend authentication and bearer-token API wiring.
2. Reconcile frontend pricing/copy with the four-tier backend credit model and
   derive plan limits from trusted user/account data.
3. Add billing and credit lifecycle automation.
4. Implement requested formats/print-ready settings end to end, then add real
   PDF/EPS/DXF/PNG output.
5. Add batch workflows.
6. Implement upload retrieval/deletion and scheduled orphan cleanup.
7. Decide and implement the production photo/AI provider strategy.
8. Add CI, aggregate test commands, observability, legal pages, and verified
   production deployment checks.
