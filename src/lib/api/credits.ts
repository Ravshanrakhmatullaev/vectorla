import { apiGet } from '@/lib/api/client'
import type { CreditsSummary } from '@/lib/api/types'

/** Newest transactions returned by GET /credits; the backend caps `limit` at 100. */
export const CREDIT_HISTORY_LIMIT = 50

/** GET /api/v1/credits — balance plus the most recent transactions. See backend/API.md. */
export function getCredits(limit = CREDIT_HISTORY_LIMIT): Promise<CreditsSummary> {
  return apiGet<CreditsSummary>(`/api/v1/credits?limit=${limit}`)
}
