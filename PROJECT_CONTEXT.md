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

The product is pre-production. Core tracing, API foundations, and the
production email/password authentication path work, while billing,
multi-format export, batch workflows, and launch operations remain incomplete.

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
- Vectorla tracing engine (`backend/src/engine/`, pure TypeScript) as the
  default provider; ImageTracer.js as fallback; `@cadit-app/potrace-ts`; jSquash
  PNG/JPEG/WebP WASM decoders
- Dev-only: `@resvg/resvg-js` for the render-and-diff quality benchmark
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
- Development-only `X-Test-User-Id` bypass for smoke tests/local Vite; it is
  ignored in staging/production and never overrides a real bearer token.

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

- **Vectorla engine** (`backend/src/engine/`) is the default for every image
  type. Pipeline: bounded working size → edge-preserving denoise (auto, or
  forced for JPEG) → OKLab palette seeded from flat pixels (plus a
  thin-detail color pass and blend-cluster removal) → interpolated
  super-sampling (1–4×) → anti-aliasing-aware labeling (coverage decided in
  sRGB) → speckle merge + adaptive region budget → planar map of shared
  boundary chains → Potrace-grade polygon + curve fitting per chain, with
  polygon-level corner restoration and least-squares junction refinement →
  stacked (default, seamless) or cutout SVG with compact path data.
- Quick and Professional Trace are engine profiles
  (`engine/profiles.ts`: 32 colors / flat fills vs 64 colors / finer merge /
  gradient reconstruction). Both trace artwork at up to 4 MP (every accepted
  upload at full resolution) and photo-like images (sampled flat fraction
  < 0.70) at 1.2 MP; larger images are reduced by a whole factor (exact k×k
  blocks). Small images are upsampled to 1.5 MP or 2 MP, and isolated
  one-pixel hairlines are restored with sharp Catmull-Rom samples
  (`ridgeMask`/`restoreRidges`) so the post-upsampling blur cannot erase them. Professional merges posterized bands back into
  regions filled with fitted `<linearGradient>`/`<radialGradient>`
  (`engine/gradients.ts`), keeping a gradient only where it fits the pixels
  better than the flat color. Stacked output draws a 1 px same-color underlay
  stroke along edges shared with later shapes (no seams), and labeling keeps
  sub-pixel hairlines (coverage-preserving thin features).
- Uploads are limited to 4 MP (decode memory, `config/index.ts`); the web app
  downscales larger images in the browser first (`src/utils/fitImageForUpload.ts`).
  The Worker decodes each upload once (`decodeForTrace`), shrinks it to the
  working size immediately, resets the WASM decoder and hands the pixels to
  the engine (`traceOwnedImage`), which streams its filters row by row,
  computes OKLab on demand and works in place. Measured inside workerd, a
  4 MP logo traced at full resolution peaks at ~46 MB live (~63 MB with no
  GC), a 4 MP photo at ~19 MB (BENCHMARKS.md "High-resolution engine"). Legacy
  preset names sent explicitly as `Job.preset` adjust engine options.
- `ImageTracer` (`PlaceholderProvider`) is the automatic fallback if the
  engine throws; `PotraceProvider` is still available; Vision/OpenAI remain stubs.
- The old Professional preprocessing stages were removed: the benchmark
  showed they made output far worse (5.95 px mean edge error).
- **Real-world benchmark** (`npm run bench -- --corpus=real`): 55 licensed
  images (emoji, icons, logos, text, hairlines, JPEG/blurred/low-res variants,
  photos, scans), gated by `realWorldGate.smoke-test.ts`. See BENCHMARKS.md.
- **Render-and-diff benchmark** (`backend/src/benchmark/`, `npm run bench`):
  11 ground-truth SVG designs × 22 raster variants, traced output rendered at
  4× and compared with the truth (OKLab ΔE, edge displacement, gaps, nodes,
  bytes). Results and the professional-tool comparison are in `BENCHMARKS.md`.
  `qualityGate.smoke-test.ts` fails on regressions or if the engine loses to
  legacy on any case.
- The older structural harness (`qualityTesting/`, `QUALITY_REPORT.md`) still
  covers the ImageTracer fallback presets.

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
- A development-only credit grant endpoint exists and returns 404 in staging
  and production.
- Orphan detection compares R2 objects against upload/conversion records.

### Persistence and integrity

- Supabase repositories exist for profiles, uploads, jobs, conversions, and
  credits.
- In-memory equivalents support local smoke tests without credentials.
- Database schema includes relevant ownership/look-up indexes, duplicate
  upload protection, optimistic-lock versions, and unique conversion storage
  keys.
- Active-job checks, completed-job idempotency, and conflict handling reduce
  duplicate queue work and double billing.

### Authentication

- Supabase email/password signup, login, logout, email-confirmation handling,
  password recovery, persistent sessions, automatic refresh, and initial
  auth-state restoration are implemented in the frontend.
- The shared API client attaches the active Supabase access token to JSON,
  multipart, polling, and raw download requests.
- Supabase `auth.users` entries are provisioned into `profiles`; upload limits
  come from the authenticated profile rather than multipart input.
- RLS plus revoked anon/authenticated grants keep application data behind the
  service-role Worker.
- Staging/production reject development identity/credit mechanisms and fail
  closed when required backend secrets are absent.

## Partially implemented

### Vectorization

The engine meets the core professional expectations on the benchmark (no
seams, exact colors, sub-pixel edges, sharp corners, few nodes, small text).
Open quality work is tracked in `ROADMAP.md` (Q3–Q15): gradient
reconstruction, JPEG-source node counts, diagonal pinch points and pixel art,
tangent continuity at junctions, 1× sub-pixel refinement, stroke output,
designer-grade SVG structure, real-image corpus, and vision assistance.
Professional's differentiator is gradient reconstruction (Q3). On flat art the
two modes score about the same.

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
use the authenticated profile plan, but that plan is not connected to a billing
subscription. Monthly grants exist as a service method but are not wired to a
billing cycle.

### Frontend integration

The workspace is connected when `VITE_API_BASE_URL` is present. The Hero
dropzone, Hero CTA buttons, pricing CTAs, API navigation destination, and
footer legal links are not functional product flows yet. Navbar sign-in/start
buttons provide the minimal account flow.

### Cleanup and operations

Orphan detection works, but there is no scheduled trigger or deletion pass.
`StorageService.deleteFile`, `UploadService.getUpload`, and
`UploadService.deleteUpload` are not implemented. The health endpoint is a
liveness check only; it does not probe R2, Queue, or Supabase dependencies.

## Not yet implemented

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
- Root `npm run lint` runs oxlint (it also scans `backend/`).
- `cd backend && npm run typecheck` runs backend TypeScript without emit.
- `cd backend && npm test` runs every `*.smoke-test.ts` (27 files) and
  reports pass/fail. This includes the engine tests, the job-lifecycle and credit
  concurrency tests (`queueConsumer.smoke-test.ts`), the decompression-bomb
  guard and the vector quality gate (~90 s).
- `cd backend && npm run bench` prints the render-and-diff benchmark;
  `-- --compare` diffs it against the committed `src/benchmark/baseline.json`.
- `backend/supabase/tests/credit_integrity.test.sql` asserts the ledger,
  constraints and signup grant on real Postgres (see the CI `database` job).
- Tests call real handlers/services with fake Cloudflare bindings and
  in-memory repositories; no real Supabase project is required. Concurrency
  and Supabase-specific paths are not exercised.
- CI: `.github/workflows/ci.yml` (frontend lint/build, backend typecheck +
  tests + Worker dry-run bundles, Postgres 16 migration tests).

## Deployment context

See `DEPLOYMENT.md` for the step-by-step runbook (resources, database
migrations, secrets, staging then production, verification, rollback).

- Frontend target: Cloudflare Pages, build `npm run build`, output `dist`.
- Backend target: Cloudflare Workers through `backend/wrangler.toml`.
- Required Worker resources: R2 bucket `vectorla-uploads`, queue
  `vectorla-conversions`, Supabase URL/service-role secret, and download URL
  signing secret.
- CORS always allows `https://vectorla.app`; localhost origins and the
  `X-Test-User-Id` header are allowed only in development.
- Repository files describe intended deployment. Do not claim the domain,
  Worker, R2 bucket, Queue, or Supabase project is live without external
  verification.
- Supabase project `rvrpuapbeglqmcajsdgm` (Vectorla, ap-northeast-2, PG 17)
  is paused. The free org allows 2 active projects, and poligrafiya and
  safar-taxi are both active. Do not pause other projects or change billing
  without the owner. Database apply order: preflight_0002.sql → schema.sql →
  0002 → preflight again (DEPLOYMENT.md §2).
- The owner's local `backend/supabase/schema.sql` has six uncommitted
  `grant select, insert, update, delete ... to service_role` statements
  (profiles, uploads, jobs, conversions, credit_balances,
  credit_transactions). They are needed and must be kept; the owner commits
  them. 0002 carries identical GRANTs, so the two files are compatible in
  either order.
- Cloudflare Pages CSP permits the intended API host, Workers deployments, and
  Supabase HTTPS endpoints. Narrow wildcard hosts once final production origins
  are confirmed.

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
10. Do not commit or push unless explicitly asked (autonomous sessions may be
    authorized to commit and push verified milestones).
11. Tracing changes must keep `npm test` green, including the vector quality
    gate; record benchmark changes in `BENCHMARKS.md`.

## Current priorities

See `ROADMAP.md` for the full prioritized list. In short:

1. Vector quality: gradient reconstruction (Q3) and lossy-source quality (Q4).
2. Production safety: decompression-bomb guard, stuck-job recovery, queue
   configuration, credit integrity, free-credit grant (P1–P5).
3. Then SaaS work: honest copy (done except Pricing), account UI (credits done),
   legal drafts (awaiting owner decisions), export formats, billing.

Frontend routes: `/` (landing + workspace), `/account` (credits), `/privacy`,
`/terms`. These use a minimal History-API router (`src/lib/router.tsx`);
Cloudflare Pages' SPA fallback serves `index.html` for deep links.
