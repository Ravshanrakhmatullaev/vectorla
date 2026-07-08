import type { Env } from '../env'
import { createConversionsRepository } from '../repositories/createConversionsRepository'
import { createJobService } from '../services/JobService'
import { createR2Client } from '../integrations/r2'
import { StorageService } from '../services/StorageService'
import { requireAuth } from '../middleware/requireAuth'
import { UnauthorizedError, NotFoundError } from '../errors'
import { EXPORT_FORMAT_MIME_TYPES } from '../config'

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

/**
 * GET /api/download?key=<r2 key>&exp=<epoch seconds>&sig=<hmac> — streams a
 * completed conversion's file straight from R2. The query string is produced
 * by StorageService.getSignedDownloadUrl and verified here via
 * StorageService.verifySignedUrl (HMAC over `key:exp`, no S3-style
 * presigning available — see that file for why).
 */
export async function handleDownloadRoute(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'GET') {
    return jsonResponse({ error: 'Method not allowed' }, 405)
  }

  let callerUserId: string
  try {
    ;({ userId: callerUserId } = await requireAuth(request, env))
  } catch (error) {
    if (error instanceof UnauthorizedError) return jsonResponse({ error: error.message }, 401)
    throw error
  }

  const r2 = createR2Client(env.UPLOADS_BUCKET)
  const storage = new StorageService(r2, env.DOWNLOAD_URL_SECRET)
  const verification = await storage.verifySignedUrl(request.url)

  // Order matters: check expiry before general signature validity, since an
  // expired link still has a well-formed (and possibly still-matching)
  // signature — callers should see "expired", not "invalid", once expired.
  if (!verification.key) {
    return jsonResponse({ error: 'Missing or malformed download signature' }, 401)
  }
  if (verification.expired) {
    return jsonResponse({ error: 'Download link has expired' }, 410)
  }
  if (!verification.valid) {
    return jsonResponse({ error: 'Invalid download signature' }, 401)
  }

  try {
    const conversions = createConversionsRepository(env)
    const conversion = await conversions.findByStorageKey(verification.key)
    if (!conversion) {
      return jsonResponse({ error: 'Conversion not found' }, 404)
    }
    if (conversion.userId !== callerUserId) {
      return jsonResponse({ error: 'This conversion does not belong to the authenticated user' }, 403)
    }

    // Defensive: a Conversion row only ever exists once its job is completed
    // (see ConversionService.processJob), but this checks that invariant
    // explicitly rather than trusting it blindly.
    const jobService = createJobService(env)
    const job = await jobService.getJob(conversion.jobId)
    if (job.status !== 'completed') {
      return jsonResponse({ error: `Job "${job.id}" is not completed (status: ${job.status})` }, 410)
    }

    const file = await storage.getFile(conversion.storageKey)
    return new Response(file, {
      status: 200,
      headers: {
        'Content-Type': EXPORT_FORMAT_MIME_TYPES[conversion.format],
        'Content-Disposition': `attachment; filename="vectorla-${conversion.id}.${conversion.format}"`,
        'Cache-Control': 'private, max-age=0, no-store',
      },
    })
  } catch (error) {
    if (error instanceof NotFoundError) return jsonResponse({ error: error.message }, 404)
    console.error('Unexpected error in GET /api/download:', error)
    return jsonResponse({ error: 'Internal Server Error' }, 500)
  }
}
