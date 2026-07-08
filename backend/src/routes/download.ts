import type { Env } from '../env'
import { createConversionsRepository } from '../repositories/createConversionsRepository'
import { createJobService } from '../services/JobService'
import { createR2Client } from '../integrations/r2'
import { StorageService } from '../services/StorageService'
import { requireAuth } from '../middleware/requireAuth'
import { jsonError, mapErrorToResponse } from '../api/response'
import { UnauthorizedError, NotFoundError } from '../errors'
import { EXPORT_FORMAT_MIME_TYPES } from '../config'

/**
 * GET /api/v1/download?key=<r2 key>&exp=<epoch seconds>&sig=<hmac> — streams a
 * completed conversion's file straight from R2. The query string is produced
 * by StorageService.getSignedDownloadUrl and verified here via
 * StorageService.verifySignedUrl (HMAC over `key:exp`, no S3-style
 * presigning available — see that file for why).
 *
 * This is the one endpoint whose success response is NOT the standard JSON
 * envelope — it streams the raw file (see backend/API.md) — but every error
 * path still uses it, same as every other route.
 */
export async function handleDownloadRoute(request: Request, env: Env, requestId: string): Promise<Response> {
  if (request.method !== 'GET') {
    return jsonError('VALIDATION_ERROR', 'Method not allowed', 405, requestId)
  }

  let callerUserId: string
  try {
    ;({ userId: callerUserId } = await requireAuth(request, env))
  } catch (error) {
    if (error instanceof UnauthorizedError) return mapErrorToResponse(error, requestId)
    throw error
  }

  const r2 = createR2Client(env.UPLOADS_BUCKET)
  const storage = new StorageService(r2, env.DOWNLOAD_URL_SECRET)
  const verification = await storage.verifySignedUrl(request.url)

  // Order matters: check expiry before general signature validity, since an
  // expired link still has a well-formed (and possibly still-matching)
  // signature — callers should see "expired", not "invalid", once expired.
  if (!verification.key) {
    return jsonError('UNAUTHORIZED', 'Missing or malformed download signature', 401, requestId)
  }
  if (verification.expired) {
    return jsonError('CONFLICT', 'Download link has expired', 410, requestId)
  }
  if (!verification.valid) {
    return jsonError('UNAUTHORIZED', 'Invalid download signature', 401, requestId)
  }

  try {
    const conversions = createConversionsRepository(env)
    const conversion = await conversions.findByStorageKey(verification.key)
    if (!conversion) {
      throw new NotFoundError('Conversion not found')
    }
    if (conversion.userId !== callerUserId) {
      return jsonError('FORBIDDEN', 'This conversion does not belong to the authenticated user', 403, requestId)
    }

    // Defensive: a Conversion row only ever exists once its job is completed
    // (see ConversionService.processJob), but this checks that invariant
    // explicitly rather than trusting it blindly.
    const jobService = createJobService(env)
    const job = await jobService.getJob(conversion.jobId)
    if (job.status !== 'completed') {
      return jsonError('CONFLICT', `Job "${job.id}" is not completed (status: ${job.status})`, 410, requestId)
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
    return mapErrorToResponse(error, requestId)
  }
}
