import type { Env } from '../env'
import type { Conversion } from '../types'
import { createConversionService } from '../services/ConversionService'
import { requireAuth } from '../middleware/requireAuth'
import { jsonSuccess, jsonPaginated, jsonError, mapErrorToResponse, withNoStore } from '../api/response'
import { UnauthorizedError } from '../errors'

const DEFAULT_LIST_LIMIT = 20
const MAX_LIST_LIMIT = 100

// The raw R2 object key must never reach a client (see Phase 17 security
// audit) — downloads always go through the signed downloadUrl instead.
function toPublicConversion(conversion: Conversion): Omit<Conversion, 'storageKey'> {
  const { storageKey: _storageKey, ...publicConversion } = conversion
  return publicConversion
}

function parsePaginationParams(url: URL): { limit: number; offset: number } {
  const limitParam = Number(url.searchParams.get('limit'))
  const offsetParam = Number(url.searchParams.get('offset'))
  const limit = Number.isFinite(limitParam) && limitParam > 0 ? Math.min(limitParam, MAX_LIST_LIMIT) : DEFAULT_LIST_LIMIT
  const offset = Number.isFinite(offsetParam) && offsetParam >= 0 ? offsetParam : 0
  return { limit, offset }
}

async function handleListConversions(url: URL, callerUserId: string, env: Env, requestId: string): Promise<Response> {
  try {
    const conversionService = createConversionService(env)
    const all = await conversionService.listUserConversions(callerUserId)
    const { limit, offset } = parsePaginationParams(url)
    const page = all.slice(offset, offset + limit).map(toPublicConversion)
    return jsonPaginated(page, { total: all.length, limit, offset, hasMore: offset + limit < all.length }, requestId)
  } catch (error) {
    return mapErrorToResponse(error, requestId)
  }
}

async function handleGetConversion(conversionId: string, callerUserId: string, env: Env, requestId: string): Promise<Response> {
  try {
    const conversionService = createConversionService(env)
    const conversion = await conversionService.getConversion(conversionId)
    if (conversion.userId !== callerUserId) {
      return jsonError('FORBIDDEN', `Conversion "${conversionId}" does not belong to the authenticated user`, 403, requestId)
    }
    return jsonSuccess(toPublicConversion(conversion), 200, requestId)
  } catch (error) {
    return mapErrorToResponse(error, requestId)
  }
}

/**
 * Handles GET /api/v1/conversions (paginated list for the authenticated
 * user) and GET /api/v1/conversions/:id (one conversion's metadata + a
 * signed R2 download URL).
 */
export async function handleConversionsRoute(request: Request, env: Env, requestId: string): Promise<Response> {
  const url = new URL(request.url)
  const segments = url.pathname.split('/').filter(Boolean) // ['api', 'v1', 'conversions', maybe ':id']
  const conversionId = segments[3]

  if (request.method !== 'GET') {
    return jsonError('VALIDATION_ERROR', 'Method not allowed', 405, requestId)
  }

  try {
    const { userId } = await requireAuth(request, env)
    if (conversionId) return withNoStore(await handleGetConversion(conversionId, userId, env, requestId))
    return await handleListConversions(url, userId, env, requestId)
  } catch (error) {
    if (error instanceof UnauthorizedError) return mapErrorToResponse(error, requestId)
    throw error
  }
}
