# Vectorla API (backend)

This is a **Cloudflare Worker**, deployed separately from the frontend
(`src/`, deployed to Cloudflare Pages). It is not wired into the root
`npm run build` / `npm run lint` at all — this folder has its own
`package.json`, `tsconfig.json`, and `wrangler.toml`, and is a fully
independent deployable.

The core upload, job, tracing, conversion retrieval/download, authentication,
and credit-enforcement paths are implemented. Remaining scaffolding is
limited to upload retrieval/deletion and the optional Vision/OpenAI providers;
see the live route/service files and `API.md` for the current contract.

## Job Queue (implemented)

Every successful `POST /api/uploads` automatically creates a `Job` (status
`queued`), persists it, and enqueues a `{ jobId }` message onto
`CONVERSION_QUEUE` — via `JobService.createJob`, called right after
`UploadService.createUpload` succeeds in `src/routes/uploads.ts`. The upload
response shape is now `{ upload, job }` instead of a bare upload object.

`POST /api/jobs` (`{ userId, uploadId, preset?, settings? }`) does the same
thing on demand — e.g. for re-processing an existing upload with different
settings. `GET /api/jobs/:id` returns the current job.

| Status | Cause |
|---|---|
| 201 | Job created and enqueued (POST /api/jobs) |
| 200 | Job found (GET /api/jobs/:id) |
| 400 | Missing `userId`/`uploadId`, or the referenced upload doesn't exist / isn't owned by that user |
| 404 | No job with that id (GET only) |
| 405 | Unsupported method |
| 500 | Unexpected failure |

**The queue consumer does not run AI yet** (per this phase's explicit scope)
— `Worker.queue()` in `src/index.ts` only exercises the state machine:
`queued` → `processing` → `completed`, then acks the message. On any error
during that (e.g. the job lookup fails), it calls `JobService.markFailed`
(setting `status: 'failed'`, `errorMessage`, and incrementing `retryCount`)
and calls `message.retry()` so Cloudflare's native Queue redelivery handles
the retry — our own `retryCount` field is bookkeeping for a future
dead-letter cutoff, not itself driving redelivery.

**Job fields:** `status` (`queued | processing | completed | failed`),
`retryCount` (starts at 0, incremented by `markFailed`), `createdAt` /
`updatedAt` (ISO timestamps), `completedAt` (set only on `markCompleted`).

**Repository fallback:** `createJobsRepository` follows the exact same
real-Supabase-or-in-memory pattern as `createUploadsRepository` — see below
for a subtlety that pattern surfaced.

## Upload API (implemented)

`POST /api/uploads` (`src/routes/uploads.ts`) is the first real feature.
Send `multipart/form-data` with a `file` field, a `userId` field, and an
optional `plan` field (defaults to `free` — see the TODO in
`UploadService.CreateUploadInput` about this being a stand-in for real auth).

Validates, in order: file name present → MIME type allowed → extension
matches the declared MIME type → not empty → within the caller's plan's
`maxFileSizeBytes` → no existing upload with the same filename for that user.
On success, stores the file in R2 (key: `uploads/<userId>/<uploadId>/<filename>`)
and writes an `Upload` row, returning it as JSON with `201`.

| Status | Cause |
|---|---|
| 201 | Created — file stored, metadata saved |
| 400 | Missing `file`/`userId` field, empty file, or duplicate filename |
| 413 | File exceeds the caller's plan's max size |
| 415 | Unsupported MIME type, or extension doesn't match the declared type |
| 405 | Method other than POST |
| 500 | Unexpected failure (e.g. R2 or Supabase error) |

**Repository fallback:** `createUploadsRepository` / `createJobsRepository`
(in `src/repositories/`) use the real `Supabase*Repository` when
`SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` are configured, and an
`InMemory*Repository` otherwise — this is what makes the upload/job flow
testable locally with no real Supabase project. Production always sets both
secrets, so it always gets the real ones.

A subtlety this surfaced: `UploadService` and `JobService` each call their
own repository factory independently. In production that's fine — every
`SupabaseXRepository` instance is a stateless client over the same external
DB. But the in-memory fallback's `new InMemoryXRepository()` is isolated
per-instance, so within one request `JobService`'s existence-check
(`uploads.findById`) couldn't see an upload `UploadService` just created a
moment earlier in a *different* in-memory instance. Both factories now cache
one in-memory repository per `env` object (a `WeakMap<Env, ...>`, scoped only
to the fallback path — never touches the real-Supabase branch), so instances
constructed within the same request/test share state.

**Known limitations:**
- No rollback if the R2 write succeeds but the Supabase write fails — would
  orphan an R2 object. Fine for a first pass; needs a cleanup job later.
- `plan` is caller-supplied, not derived from an authenticated session, since
  auth doesn't exist yet — not secure, documented as a TODO in the code.
- `GET /api/uploads/:id` and `DELETE /api/uploads/:id` are still stubs
  (`UploadService.getUpload` / `deleteUpload` still throw).
- `POST /api/uploads`'s response shape changed in Phase 10, from a bare
  `Upload` to `{ upload, job }` — there's no real frontend/API consumer yet,
  so this wasn't a breaking change for anyone, but flagging it since it's a
  shape change to a previously-"final" response.

**Testing locally:** five smoke-test scripts run with plain Node (via `tsx`,
a dev dependency) and need no real Cloudflare/Supabase credentials:

```bash
npx tsx src/services/UploadService.smoke-test.ts   # upload validation rules, in-memory fakes for R2 + repository
npx tsx src/services/JobService.smoke-test.ts       # job creation/lookup + the queued/processing/completed/failed state machine
npx tsx src/routes/uploads.smoke-test.ts            # POST /api/uploads, verifying every HTTP status code + the auto-created job
npx tsx src/routes/jobs.smoke-test.ts               # POST /api/jobs and GET /api/jobs/:id, verifying every HTTP status code
npx tsx src/index.smoke-test.ts                     # the Worker's queue() consumer, using a fake MessageBatch
```

`wrangler dev` itself did not start cleanly in the sandbox this was built in
(a `workerd` runtime crash, likely a Windows/Git-Bash process-handling
quirk) — but every script above calls the exact same functions Wrangler
would invoke, so the business logic is verified either way. Worth re-trying
`wrangler dev` in a normal terminal/CI environment before shipping.

## Public API (v1) — Phase 21

Every route now lives under `/api/v1/` and returns a standard envelope
(`SuccessResponse<T>` / `ErrorResponse` / `PaginatedResponse<T>`, see
`src/api/response.ts`) with a `requestId` (also echoed as `X-Request-Id`),
plus an `X-Response-Time` header and a structured JSON log line per request
(`src/api/logging.ts`). CORS is handled centrally (`src/api/cors.ts`) —
`vectorla.app` always, `localhost:*` outside production only. Errors use a
fixed 7-code vocabulary (`VALIDATION_ERROR`, `UNAUTHORIZED`, `FORBIDDEN`,
`NOT_FOUND`, `CONFLICT`, `INSUFFICIENT_CREDITS`, `INTERNAL_ERROR`) — see
`mapErrorToResponse()`, the single place that maps a thrown error class to
(code, HTTP status).

Full endpoint reference: **[API.md](./API.md)**. Machine-readable spec:
`GET /api/v1/openapi.json`, generated from the hand-maintained
`src/api/openapi.ts` (no schema-validation library exists in this codebase
yet to generate it from — see "What's still a decision" below).

`GET /api/v1/conversions` (paginated list) is new this phase — the only net-new
route; everything else is the same functionality under the new prefix/envelope.

## Request flow (once implemented)

1. `POST /api/v1/uploads` — client uploads a raster image. `UploadService`
   stores the file via `StorageService`/R2 and records an `Upload` row.
2. `POST /api/v1/jobs` — client requests a conversion. A `Job` row is created
   (`status: queued`) and `QueueService` pushes a message onto
   `CONVERSION_QUEUE`.
3. The Worker's `queue()` handler consumes that message and calls
   `ConversionService.processJob()` — **this is where the real AI/tracing
   call will eventually go.** It writes result files via `StorageService`,
   creates `Conversion` rows, and debits credits via `CreditsService`.
4. `GET /api/v1/jobs/:id` — client polls for job status.
5. `GET /api/v1/conversions/:id` (or `/api/v1/conversions` for a paginated
   list) — metadata + a signed R2 download URL.
6. `GET /api/v1/credits` — current balance and recent transactions.
7. `GET /api/v1/history` — paginated past jobs with their conversion IDs.

## Folder structure

```
backend/
  src/
    index.ts            Worker entry point — fetch() dispatch + queue() consumer.
    env.ts               Env interface — the Worker bindings/secrets contract.
    routes/              Authenticated API handlers.
    services/            Upload, queue, conversion, storage, analysis, and credits
                         business logic.
    integrations/        Thin wrappers over raw Cloudflare bindings / Supabase SDK
                         (r2.ts, queue.ts, supabase.ts). Services depend on these,
                         never on the raw binding types directly.
    types/               Shared TypeScript types: User, Upload, Job, Conversion,
                         Credits, History. These are real, fully-typed — only
                         functions are stubbed, not the data model.
    config/               Real configuration constants (upload limits, allowed
                         MIME types, credit costs) — not stubbed, since these
                         aren't logic, just values.
  supabase/
    schema.sql           Real, valid Postgres schema mirroring src/types/.
                         Run this against a Supabase project when ready.
  wrangler.toml           Cloudflare Worker config: R2 bucket binding, Queue
                         producer/consumer binding, vars.
  .dev.vars.example       Template for local secrets (copy to .dev.vars).
  package.json / tsconfig.json   Standalone — not part of the root workspace.
```

## Why services sit on top of integrations

`integrations/*` wrap the raw Cloudflare bindings (`R2Bucket`, `Queue`) and
the Supabase SDK client — nothing more than "here's how you talk to this
system." `services/*` are the business-facing layer other code actually
calls (`UploadService.createUpload(...)`), and depend on an integration
client via constructor injection rather than touching bindings directly.
This means swapping storage providers later only touches `integrations/r2.ts`
and its call sites in `services/`, not every route handler.

## Setup (when real implementation begins)

```bash
cd backend
npm install
cp .dev.vars.example .dev.vars   # fill in real Supabase credentials
npx wrangler r2 bucket create vectorla-uploads
npx wrangler queues create vectorla-conversions
npm run dev                       # local Worker dev server
```

Then run `supabase/schema.sql` against your Supabase project (SQL editor or
`supabase db push`), and set the same two secrets in production with
`wrangler secret put`.

## Pricing & Credits

Four plans, all sharing one credit system (`PLAN_LIMITS` in `src/config/index.ts`,
`UserPlan` in `src/types/user.ts`):

| Plan | Price | Credits/mo | Max file size | Batch size | Formats | Print-ready | API |
|---|---|---|---|---|---|---|---|
| Free | $0 | 10 | 5 MB | 1 (no batch) | SVG, PNG | +1 credit | No |
| Starter | $9/mo | 100 | 25 MB | 10 | SVG, PNG, PDF | included | No |
| Pro | $19/mo | 500 | 100 MB | 100 | all 5 formats | included | No |
| Business | Custom | 5,000+ | 500 MB | 1,000 | all 5 + custom presets | included | Yes |

**Credit costs per operation** (`CREDIT_COST_*` in `src/config/index.ts`):
- Base conversion (1 image → 1 export format): 1 credit
- Each additional export format on the same job: +1 credit
- Print-ready mode (CMYK validation, cut lines): +1 credit — free/included on
  Starter and above, since it's core to who those plans target (print shops,
  CNC/laser users)
- Batch jobs: no discount or premium — cost is simply credits × image count

**Overage** (not implemented, documented for later): Free/Starter should
block further conversions once credits run out until the monthly reset or an
upgrade; Pro/Business should be able to purchase top-up credit packs. No
Stripe integration exists yet — this is a design note, not a built feature.

**Frontend is not updated yet.** The rendered pricing section
(`src/data/pricing.ts`, `src/data/i18n.ts`'s `pricing` translations,
`PricingPlanId` in `src/data/i18n.ts`) still reflects the old 3-tier,
credits-free model (`free` / `pro` / `business`, "unlimited conversions" on
Pro). Bringing the frontend in line with this table — adding the Starter
tier, replacing "conversions" language with credits, and reconciling "Pro:
unlimited" with a concrete 500/mo — is intentionally deferred to a future
phase, per this phase's "do not change UI yet" scope.

## What "prepared" means here vs. what's still a decision

This scaffold assumes a **server-side** vectorization pipeline (R2 + Queue +
a Worker doing the actual AI call), which is one of the two options the
frontend's `PROJECT_CONTEXT.md` roadmap leaves open (the other being
client-side Web Worker + tracing library). Nothing here forces that choice
irreversibly — `ConversionService.processJob()` is the single seam where
either approach would plug in — but the R2/Queue/Supabase scaffolding itself
is server-side-shaped by design, per this phase's explicit tasks.
