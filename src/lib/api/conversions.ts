import { apiGet, getApiBaseUrl } from '@/lib/api/client'
import type { Conversion } from '@/lib/api/types'

/** GET /api/v1/conversions/:id — see backend/API.md. */
export function getConversion(conversionId: string): Promise<Conversion> {
  return apiGet<Conversion>(`/api/v1/conversions/${conversionId}`)
}

/**
 * A Conversion's `downloadUrl` is already a complete relative URL
 * (`/api/v1/download?key=&exp=&sig=`, see backend/API.md) — this just
 * resolves it against the configured API host, never constructed by hand.
 */
export function resolveDownloadUrl(downloadUrl: string): string {
  return `${getApiBaseUrl()}${downloadUrl}`
}
