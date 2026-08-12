import type { Env } from '../env'
import { createHistoryService } from '../services/HistoryService'
import { requireAuth } from '../middleware/requireAuth'
import { jsonError, jsonPaginated, mapErrorToResponse, withNoStore } from '../api/response'

const DEFAULT_HISTORY_LIMIT = 20
const MAX_HISTORY_LIMIT = 100

function parsePaginationParams(url: URL): { limit: number; offset: number } {
  const requestedLimit = Number(url.searchParams.get('limit'))
  const requestedOffset = Number(url.searchParams.get('offset'))
  const limit = Number.isInteger(requestedLimit) && requestedLimit > 0
    ? Math.min(requestedLimit, MAX_HISTORY_LIMIT)
    : DEFAULT_HISTORY_LIMIT
  const offset = Number.isInteger(requestedOffset) && requestedOffset >= 0 ? requestedOffset : 0
  return { limit, offset }
}

/** GET /api/v1/history -- paginated past jobs and their conversion ids for the caller. */
export async function handleHistoryRoute(request: Request, env: Env, requestId: string): Promise<Response> {
  if (request.method !== 'GET') {
    return withNoStore(jsonError('VALIDATION_ERROR', 'Method not allowed', 405, requestId))
  }

  try {
    const { userId } = await requireAuth(request, env)
    const { limit, offset } = parsePaginationParams(new URL(request.url))
    const { entries, total } = await createHistoryService(env).listUserHistory(userId, limit, offset)
    return withNoStore(jsonPaginated(entries, {
      total,
      limit,
      offset,
      hasMore: offset + entries.length < total,
    }, requestId))
  } catch (error) {
    return withNoStore(mapErrorToResponse(error, requestId))
  }
}
