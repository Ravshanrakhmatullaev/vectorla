import { apiFetchRaw, apiGet, getApiBaseUrl, ApiError, type ApiErrorCode } from '@/lib/api/client'
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

interface DownloadErrorEnvelope {
  success: false
  error?: { code: ApiErrorCode; message: string }
  requestId?: string
}

/**
 * Fetches the actual file bytes behind a Conversion's downloadUrl, with auth
 * headers attached (see apiFetchRaw — a plain `<a href>`/`window.open` can't
 * do this, since GET /download requires the same Authorization/X-Test-User-Id
 * header as every other route). Used to both render the SVG result inline
 * and to drive a real client-side download via an object URL.
 */
export async function fetchConversionFile(downloadUrl: string): Promise<Blob> {
  const response = await apiFetchRaw(downloadUrl)
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as DownloadErrorEnvelope | null
    throw new ApiError(
      body?.error?.message ?? `Download failed with status ${response.status}`,
      body?.error?.code ?? 'INTERNAL_ERROR',
      response.status,
      body?.requestId ?? null,
    )
  }
  return response.blob()
}
