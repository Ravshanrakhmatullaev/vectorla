import type { ExportFormat } from './conversion'
import type { UserPlan } from './user'

export interface PlanLimits {
  monthlyCredits: number
  maxFileSizeBytes: number
  /** Max images per batch job. 1 means batch processing is unavailable. */
  maxBatchSize: number
  exportFormats: ExportFormat[]
  printReadyIncluded: boolean
  apiAccess: boolean
  /** Abuse limits (services/UsageLimitsService.ts): uploads per rolling 10 minutes and per rolling 24 hours. */
  uploadsPerTenMinutes: number
  uploadsPerDay: number
  /** Total size of a user's stored originals (kept UPLOAD_RETENTION_DAYS), checked before each upload. */
  storageQuotaBytes: number
  /** Conversions a user may have queued or processing at once. */
  maxActiveJobs: number
}

export type PlanLimitsByPlan = Record<UserPlan, PlanLimits>
