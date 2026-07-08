import type { Env } from '../env'
import { createConversionService } from '../services/ConversionService'
import { NotFoundError } from '../errors'

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

async function handleGetConversion(conversionId: string, env: Env): Promise<Response> {
  try {
    const conversionService = createConversionService(env)
    const conversion = await conversionService.getConversion(conversionId)
    return jsonResponse(conversion, 200)
  } catch (error) {
    if (error instanceof NotFoundError) return jsonResponse({ error: error.message }, 404)
    console.error('Unexpected error in GET /api/conversions/:id:', error)
    return jsonResponse({ error: 'Internal Server Error' }, 500)
  }
}

/** Handles GET /api/conversions/:id (metadata + a signed R2 download URL). */
export async function handleConversionsRoute(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url)
  const segments = url.pathname.split('/').filter(Boolean) // ['api', 'conversions', maybe ':id']
  const conversionId = segments[2]

  if (request.method === 'GET' && conversionId) {
    return handleGetConversion(conversionId, env)
  }
  return jsonResponse({ error: 'Method not allowed' }, 405)
}
