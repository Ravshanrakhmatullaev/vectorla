import type { PlanLimitsByPlan, ExportFormat } from '../types'

// SVG is deliberately excluded — an uploaded SVG can carry <script>/event-handler
// payloads (stored-XSS risk) if ever rendered or served back. Only backend-generated
// SVG output (see providers/PlaceholderProvider.ts) is ever produced by this system.
export const ALLOWED_UPLOAD_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const

// Decompression-bomb limits, enforced from the file header before any decode
// (see providers/imageDimensions.ts). 40 MP of RGBA is 160 MB — the decoded
// buffer alone would exceed a Worker's 128 MB, so the real ceiling is set by
// memory, not taste: 24 MP (96 MB RGBA) leaves room for the tracing engine,
// which area-downsamples everything to <= 2 MP immediately after decode.
export const MAX_IMAGE_PIXELS = 24_000_000
export const MAX_IMAGE_DIMENSION = 12_000

// Hard ceiling on an upload request body, checked from Content-Length before
// the body is buffered. Plan limits above this can't be honored by a Worker
// holding the file in memory (see ROADMAP P6 on plan size limits).
export const MAX_UPLOAD_BODY_BYTES = 30 * 1024 * 1024

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

export const PLAN_LIMITS: PlanLimitsByPlan = {
  free: {
    monthlyCredits: 10,
    maxFileSizeBytes: 5 * 1024 * 1024,
    maxBatchSize: 1,
    exportFormats: ['svg', 'png'],
    printReadyIncluded: false,
    apiAccess: false,
  },
  starter: {
    monthlyCredits: 100,
    maxFileSizeBytes: 25 * 1024 * 1024,
    maxBatchSize: 10,
    exportFormats: ['svg', 'png', 'pdf'],
    printReadyIncluded: true,
    apiAccess: false,
  },
  pro: {
    monthlyCredits: 500,
    maxFileSizeBytes: 100 * 1024 * 1024,
    maxBatchSize: 100,
    exportFormats: ['svg', 'pdf', 'eps', 'dxf', 'png'],
    printReadyIncluded: true,
    apiAccess: false,
  },
  business: {
    monthlyCredits: 5000,
    maxFileSizeBytes: 500 * 1024 * 1024,
    maxBatchSize: 1000,
    exportFormats: ['svg', 'pdf', 'eps', 'dxf', 'png'],
    printReadyIncluded: true,
    apiAccess: true,
  },
}
