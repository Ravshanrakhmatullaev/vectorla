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
}

export type PlanLimitsByPlan = Record<UserPlan, PlanLimits>
