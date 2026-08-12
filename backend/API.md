# Vectorla API (v1)

Base URL: `/api/v1` (see `wrangler.toml`/deployment domain for the host).
Machine-readable spec: `GET /api/v1/openapi.json` (generated from
`src/api/openapi.ts`, the source of truth — this file is the human-readable
summary of the same routes).

## Authentication

Every route except `GET /health` and `GET /openapi.json` requires:

```
Authorization: Bearer <supabase-jwt>
```

Verified via Supabase's Auth server (see `src/services/AuthService.ts`).
Missing/invalid tokens get `401 UNAUTHORIZED`.

## Response envelope

Every JSON response (the one exception: `GET /download`'s successful file
stream, which returns raw bytes) is one of:

```jsonc
// Success
{ "success": true, "data": { /* ... */ }, "requestId": "..." }

// Paginated success
{ "success": true, "data": [ /* ... */ ], "pagination": { "total": 42, "limit": 20, "offset": 0, "hasMore": true }, "requestId": "..." }

// Error
{ "success": false, "error": { "code": "NOT_FOUND", "message": "..." }, "requestId": "..." }
```

`requestId` is also echoed back as the `X-Request-Id` response header, and
appears in the server-side structured log line for that request — use it to
correlate a client-reported issue with server logs.

## Error codes

| Code | Typical HTTP status |
|---|---|
| `VALIDATION_ERROR` | 400, 405, 413, 415 |
| `UNAUTHORIZED` | 401 |
| `FORBIDDEN` | 403 |
| `NOT_FOUND` | 404 |
| `CONFLICT` | 409, 410 |
| `INSUFFICIENT_CREDITS` | 402 |
| `INTERNAL_ERROR` | 500, 501 |

`code` is for programmatic branching; the HTTP status carries the transport
detail (e.g. both 413 and 415 are `VALIDATION_ERROR`).

## Other response headers (every request)

- `X-Response-Time: <n>ms` — server-side processing time.
- `X-Request-Id` — same value as the body's `requestId`.
- `Access-Control-Allow-Origin` — present when the request's `Origin` is on
  the allowlist (`https://vectorla.app` always; `http://localhost:<port>`
  outside production only — see `src/api/cors.ts`).

## Endpoints

### `POST /uploads`

`multipart/form-data` with a `file` field (PNG/JPEG/WEBP) and optional `plan`
field. Also auto-creates and enqueues a conversion `Job`, and runs
`ImageAnalysisService` (Phase 21) on the uploaded image — dimensions, color/
transparency/grayscale stats, a `photo`/`illustration`/`logo` classification,
the provider `ConversionService` will actually attempt (`recommendedProvider`),
and rough `estimatedQuality`/`estimatedCredits`/`estimatedProcessingTimeMs`
figures. This is computed fresh on each call (not persisted or re-fetchable
later) — see `ImageAnalysisResult` in `src/services/ImageAnalysisService.ts`.
Best-effort: if decoding fails here (rare — `validateFileSignature` already
rejected anything with the wrong magic bytes), `analysis` is `null` and the
upload/job still succeed as normal; the queue consumer still runs the same
decode for real when it processes the job.

`data: { upload: Upload, job: Job, analysis: ImageAnalysis | null }` · `201`

### `POST /jobs`

`{ uploadId, preset?, settings?, supersedesJobId? }` — creates (or resumes) a
conversion job. An upload with an already-active job returns that job
unchanged (see backend/README.md's Phase 18 notes on duplicate-job handling).

Passing `preset: "professional"` (the exact value of
`PROFESSIONAL_TRACE_JOB_PRESET` in
`src/pipeline/ProfessionalTracePipeline.ts`) routes the job through the full
Professional Trace preprocessing pipeline instead of the normal Quick Trace
flow, and bills `PROFESSIONAL_TRACE_CREDIT_MULTIPLIER` (2x) the base credit
cost instead of 1x — see `ConversionService.processJob`. Any other preset
value (including omitted) is unaffected.

`supersedesJobId` (Phase 26): the id of an already-*completed* job for the
same upload that this new job replaces — e.g. re-tracing an upload with
Professional Trace after its automatic Quick Trace job already finished. If
that job was billed, its debit is refunded before the new job is created, so
re-choosing how an upload is traced never stacks charges on top of a prior
one. Silently ignored if the referenced job doesn't belong to the caller,
isn't for this upload, or isn't `completed` (nothing to refund).

`data: Job` · `201`

### `GET /jobs/:id`

`data: Job` · `200`

### `GET /jobs/:id/conversion`

Resolves a job to its result:

- `200` — completed: `data: { status: "completed", conversion: Conversion }`
- `202` — still queued/processing: `data: { status: "queued" | "processing" }`
- `410` — failed: `data: { status: "failed", error: string }` (still a
  **success** envelope — the request correctly reported the job's true state)

### `GET /conversions`

Paginated list of the caller's completed conversions. Query params: `limit`
(default 20, max 100), `offset` (default 0).

`data: Conversion[]`, `pagination: { total, limit, offset, hasMore }` · `200`

### `GET /conversions/:id`

`data: Conversion` (never includes `storageKey` — see Phase 17 security
notes) · `200`

### `GET /credits`

Returns the authenticated caller's current credit balance and newest
balance-affecting transactions. Optional query param: `limit` (default 20,
max 100). Transaction objects omit `userId` because every entry is already
scoped to the authenticated caller.

`data: { balance: number, transactions: CreditTransaction[] }` · `200`

### `GET /history`

Returns the authenticated caller's jobs newest first, with any conversion IDs
produced by each job. Query params: `limit` (default 20, max 100) and `offset`
(default 0). The response uses the standard paginated envelope and is derived
from the existing job/conversion records; there is no separate history table.

`data: HistoryEntry[]`, `pagination: { total, limit, offset, hasMore }` · `200`

### `GET /download?key=&exp=&sig=`

Streams the file directly — **not** JSON-wrapped on success. `key`/`exp`/`sig`
come from a `Conversion.downloadUrl` (already a complete relative URL — don't
construct these by hand). Headers: `Content-Type` (matches the conversion
format), `Content-Disposition: attachment`, `Cache-Control: no-store`.

### `GET /health`

No auth required. `data: { status: "ok", environment, timestamp }` · `200`

### `GET /openapi.json`

No auth required. Returns the OpenAPI 3.0 document, unwrapped.
