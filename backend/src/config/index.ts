import type { ExportFormat, UserPlan } from '../types'

export const MAX_UPLOAD_SIZE_BYTES = 25 * 1024 * 1024 // 25MB

export const ALLOWED_UPLOAD_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'] as const

export const DEFAULT_EXPORT_FORMATS: ExportFormat[] = ['svg', 'pdf', 'eps', 'dxf', 'png']

export const CREDIT_COST_PER_CONVERSION = 1

export const MONTHLY_CREDIT_GRANT_BY_PLAN: Record<UserPlan, number> = {
  free: 5,
  pro: 500,
  business: 5000,
}
