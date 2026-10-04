import type { PlanLimitsByPlan, ExportFormat } from '../types'

// SVG is deliberately excluded — an uploaded SVG can carry <script>/event-handler
// payloads (stored-XSS risk) if ever rendered or served back. Only backend-generated
// SVG output (see providers/PlaceholderProvider.ts) is ever produced by this system.
export const ALLOWED_UPLOAD_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const

// Decompression-bomb / memory limits, enforced from the file header before
// any decode (see providers/imageDimensions.ts). A Worker has 128 MB for
// everything, including WebAssembly memory, which never shrinks once grown.
// Measured (Node, production decoders): decoding costs ~12 bytes per source
// pixel (4 MP JPEG +48 MB, 12 MP +140 MB, 24 MP +280 MB) while it runs. The
// decode is then reduced to the working size (artwork up to 4 MP, photos
// 1.2 MP) and the decoder released (providers/imageDecoder.ts), so a 4 MP
// trace peaks at ~47 MB live (BENCHMARKS.md "High-resolution engine"). The web app downscales
// larger images in the browser before upload (src/utils/fitImageForUpload.ts),
// so ordinary phone photos still work.
export const MAX_IMAGE_PIXELS = 4_000_000
export const MAX_IMAGE_DIMENSION = 12_000

/**
 * Largest file any plan may upload. Measured in workerd (BENCHMARKS.md
 * "Launch readiness"): the worst 15 MB file (a 16-bit noise PNG) peaks at
 * ~88 MB while decoding (file + 51 MB decoder memory + 16 MB pixels) and
 * ~60 MB while tracing; a 25 MB file would reach ~110 MB of the Worker's
 * 128 MB.
 */
export const MAX_UPLOAD_FILE_BYTES = 15 * 1024 * 1024

/**
 * Hard ceiling on an upload request body (the file plus multipart framing),
 * enforced while the body is read (api/readLimitedBody.ts), with or without
 * a Content-Length header.
 */
export const MAX_UPLOAD_BODY_BYTES = MAX_UPLOAD_FILE_BYTES + 1024 * 1024

/**
 * Largest upload whose image analysis is computed in the upload request
 * itself (a best-effort preview; the queue consumer always analyses). That
 * request already holds the body twice (form data and an ArrayBuffer copy),
 * and decoding adds the decoder's WebAssembly memory (~51 MB for a 15.5 MB
 * 16-bit 4 MP PNG) plus the 16 MB RGBA result: ~110 MB for a 15 MB file.
 */
export const UPLOAD_ANALYSIS_MAX_BYTES = 8 * 1024 * 1024

// --- Job processing (see ConversionService.processJob / index.ts queue()) ---
// A 'processing' job belongs to the delivery that claimed it for this long;
// a later delivery may take it over once the lease expires (Worker crashed,
// hit its CPU limit, or was evicted mid-job). Must exceed the worst-case
// processing time (tracing is seconds; cpu_ms is 60 s in wrangler.toml).
export const JOB_LEASE_MS = 5 * 60 * 1000
// Transient failures are retried; after this many attempts a job fails
// terminally and its credits are refunded.
export const MAX_JOB_ATTEMPTS = 3
// Scheduled sweeper: jobs stuck this long are failed and refunded, as a
// backstop for lost queue messages.
export const STALE_PROCESSING_JOB_MS = 20 * 60 * 1000
export const STALE_QUEUED_JOB_MS = 60 * 60 * 1000

// Free credits granted once at signup (Postgres handle_new_user trigger,
// supabase/migrations/0002_credit_integrity.sql) — keep the two in sync.
export const FREE_SIGNUP_CREDITS = 10

/**
 * Uploaded images and every result traced from them are deleted this long
 * after upload (owner decision; stated in the Privacy Policy, src/pages/legal).
 * Enforced by the scheduled RetentionService.
 */
export const UPLOAD_RETENTION_DAYS = 30
/** Uploads purged per cron run; the cron runs every 15 minutes, so a backlog drains quickly. */
export const RETENTION_PURGE_BATCH_SIZE = 50

/** Content-Type to send when streaming a conversion's file — see routes/download.ts. */
export const EXPORT_FORMAT_MIME_TYPES: Record<ExportFormat, string> = {
  svg: 'image/svg+xml',
  png: 'image/png',
  pdf: 'application/pdf',
  eps: 'application/postscript',
  dxf: 'application/dxf',
}

// Credit costs per operation. 1 credit = 1 image processed in 1 export
// format. See backend/README.md "Pricing & Credits" for the full rationale.
export const CREDIT_COST_BASE_CONVERSION = 1
export const CREDIT_COST_ADDITIONAL_EXPORT_FORMAT = 1
export const CREDIT_COST_PRINT_READY_MODE = 1

// Abuse limits (uploadsPerTenMinutes, uploadsPerDay, storageQuotaBytes,
// maxActiveJobs) sit far above normal use: a designer tracing a batch of
// logos uploads a few dozen files an hour, holds a few hundred MB within the
// 30-day retention, and waits for one or two conversions at a time.
export const PLAN_LIMITS: PlanLimitsByPlan = {
  free: {
    monthlyCredits: 10,
    maxFileSizeBytes: 5 * 1024 * 1024,
    maxBatchSize: 1,
    exportFormats: ['svg', 'png'],
    printReadyIncluded: false,
    apiAccess: false,
    uploadsPerTenMinutes: 20,
    uploadsPerDay: 100,
    storageQuotaBytes: 250 * 1024 * 1024,
    maxActiveJobs: 2,
  },
  starter: {
    monthlyCredits: 100,
    maxFileSizeBytes: MAX_UPLOAD_FILE_BYTES,
    maxBatchSize: 10,
    exportFormats: ['svg', 'png', 'pdf'],
    printReadyIncluded: true,
    apiAccess: false,
    uploadsPerTenMinutes: 60,
    uploadsPerDay: 600,
    storageQuotaBytes: 2 * 1024 * 1024 * 1024,
    maxActiveJobs: 4,
  },
  pro: {
    monthlyCredits: 500,
    maxFileSizeBytes: MAX_UPLOAD_FILE_BYTES,
    maxBatchSize: 100,
    exportFormats: ['svg', 'pdf', 'eps', 'dxf', 'png'],
    printReadyIncluded: true,
    apiAccess: false,
    uploadsPerTenMinutes: 60,
    uploadsPerDay: 1000,
    storageQuotaBytes: 10 * 1024 * 1024 * 1024,
    maxActiveJobs: 6,
  },
  business: {
    monthlyCredits: 5000,
    maxFileSizeBytes: MAX_UPLOAD_FILE_BYTES,
    maxBatchSize: 1000,
    exportFormats: ['svg', 'pdf', 'eps', 'dxf', 'png'],
    printReadyIncluded: true,
    apiAccess: true,
    uploadsPerTenMinutes: 120,
    uploadsPerDay: 3000,
    storageQuotaBytes: 50 * 1024 * 1024 * 1024,
    maxActiveJobs: 10,
  },
}
