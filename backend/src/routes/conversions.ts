import type { Env } from '../env'
import { createConversionService } from '../services/ConversionService'
import { requireAuth } from '../middleware/requireAuth'
import { NotFoundError, UnauthorizedError } from '../errors'

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

async function handleGetConversion(conversionId: string, callerUserId: string, env: Env): Promise<Response> {
  try {
    const conversionService = createConversionService(env)
    const conversion = await conversionService.getConversion(conversionId)
    if (conversion.userId !== callerUserId) {
      return jsonResponse({ error: `Conversion "${conversionId}" does not belong to the authenticated user` }, 403)
    }
    return jsonResponse(conversion, 200)
  } catch (error) {
    if (error instanceof NotFoundError) return jsonResponse({ error: error.message }, 404)
    console.error('Unexpected error in GET /api/conversions/:id:', error)
    return jsonResponse({ error: 'Internal Server Error' }, 500)
  }
}

/** Handles GET /api/conversions/:id (metadata + a signed R2 download URL) for the authenticated caller. */
export async function handleConversionsRoute(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url)
  const segments = url.pathname.split('/').filter(Boolean) // ['api', 'conversions', maybe ':id']
  const conversionId = segments[2]

  if (request.method === 'GET' && conversionId) {
    try {
      const { userId } = await requireAuth(request, env)
      return await handleGetConversion(conversionId, userId, env)
    } catch (error) {
      if (error instanceof UnauthorizedError) return jsonResponse({ error: error.message }, 401)
      throw error
    }
  }
  return jsonResponse({ error: 'Method not allowed' }, 405)
}
