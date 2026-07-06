# Vectorla API (backend) — architecture scaffold, not yet implemented

This is a **Cloudflare Worker**, deployed separately from the frontend
(`src/`, deployed to Cloudflare Pages). It is not wired into the root
`npm run build` / `npm run lint` at all — this folder has its own
`package.json`, `tsconfig.json`, and `wrangler.toml`, and is a fully
independent deployable.

**Nothing here works yet.** Every route handler and every service method
throws `new Error('Not implemented')`. This exists purely to define the
shape of the API, the data model, and the integration points so real
implementation (including AI vectorization) can be dropped in later without
re-architecting anything.

## Request flow (once implemented)

1. `POST /api/uploads` — client uploads a raster image. `UploadService`
   stores the file via `StorageService`/R2 and records an `Upload` row.
2. `POST /api/jobs` — client requests a conversion. A `Job` row is created
   (`status: queued`) and `QueueService` pushes a message onto
   `CONVERSION_QUEUE`.
3. The Worker's `queue()` handler consumes that message and calls
   `ConversionService.processJob()` — **this is where the real AI/tracing
   call will eventually go.** It writes result files via `StorageService`,
   creates `Conversion` rows, and debits credits via `CreditsService`.
4. `GET /api/jobs/:id` — client polls for job status.
5. `GET /api/conversions/:id` — metadata + a signed R2 download URL.
6. `GET /api/credits` / `GET /api/history` — balance and past activity.

## Folder structure

```
backend/
  src/
    index.ts            Worker entry point — fetch() dispatch + queue() consumer.
                         The dispatch itself is real; every handler it calls throws.
    env.ts               Env interface — the Worker bindings/secrets contract.
    routes/              One handler per resource area. All throw "Not implemented".
    services/            Business-facing layer: UploadService, QueueService,
                         ConversionService, StorageService, CreditsService.
                         All methods throw "Not implemented".
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
