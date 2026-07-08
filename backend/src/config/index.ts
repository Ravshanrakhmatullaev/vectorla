import type { PlanLimitsByPlan, ExportFormat } from '../types'

export const ALLOWED_UPLOAD_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'] as const

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
