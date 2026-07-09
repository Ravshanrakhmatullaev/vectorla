import type { Env } from '../env'
import type { Conversion } from '../types'
import { createJobService } from '../services/JobService'
import { createConversionService } from '../services/ConversionService'
import { requireAuth } from '../middleware/requireAuth'
import { jsonSuccess, jsonError, mapErrorToResponse, withNoStore } from '../api/response'
import { UnauthorizedError } from '../errors'

// The raw R2 object key must never reach a client (see Phase 17 security
// audit) — downloads always go through the signed downloadUrl instead.
function toPublicConversion(conversion: Conversion): Omit<Conversion, 'storageKey'> {
  const { storageKey: _storageKey, ...publicConversion } = conversion
  return publicConversion
}

interface CreateJobBody {
  uploadId?: unknown
  preset?: unknown
  settings?: unknown
}

function isRecordOfNumbers(value: unknown): value is Record<string, number> {
  if (typeof value !== 'object' || value === null) return false
  return Object.values(value).every((v) => typeof v === 'number')
}

async function handleCreateJob(request: Request, env: Env, requestId: string): Promise<Response> {
  const { userId } = await requireAuth(request, env)

  let body: CreateJobBody
  try {
    body = (await request.json()) as CreateJobBody
  } catch {
    return jsonError('VALIDATION_ERROR', 'Expected a JSON body', 400, requestId)
  }

  if (typeof body.uploadId !== 'string' || body.uploadId.length === 0) {
    return jsonError('VALIDATION_ERROR', 'Missing "uploadId" field', 400, requestId)
  }

  try {
    const jobService = createJobService(env)
    const job = await jobService.createJob({
      userId,
      uploadId: body.uploadId,
      preset: typeof body.preset === 'string' ? body.preset : undefined,
      settings: isRecordOfNumbers(body.settings) ? body.settings : undefined,
    })
    return jsonSuccess(job, 201, requestId)
  } catch (error) {
    return mapErrorToResponse(error, requestId)
  }
}

async function handleGetJob(jobId: string, callerUserId: string, env: Env, requestId: string): Promise<Response> {
  try {
    const jobService = createJobService(env)
    const job = await jobService.getJob(jobId)
    if (job.userId !== callerUserId) {
      return jsonError('FORBIDDEN', `Job "${jobId}" does not belong to the authenticated user`, 403, requestId)
    }
    return jsonSuccess(job, 200, requestId)
  } catch (error) {
    return mapErrorToResponse(error, requestId)
  }
}

/**
 * GET /api/v1/jobs/:id/conversion — maps the job's current state to an HTTP
 * status: 200 once the conversion is ready (with a download URL), 202 while
 * still queued/processing, 410 if the job failed (won't ever produce one),
 * 403 if the job belongs to someone else, 404 if the job itself doesn't exist.
 * All of these (including 410) are SuccessResponse — the request itself
 * succeeded in telling the caller the job's true state.
 */
async function handleGetJobConversion(jobId: string, callerUserId: string, env: Env, requestId: string): Promise<Response> {
  try {
    const conversionService = createConversionService(env)
    const result = await conversionService.getConversionByJob(jobId)

    if (result.userId !== callerUserId) {
      return jsonError('FORBIDDEN', `Job "${jobId}" does not belong to the authenticated user`, 403, requestId)
    }
    if (result.jobStatus === 'completed') {
      const conversion = result.conversion ? toPublicConversion(result.conversion) : null
      return jsonSuccess({ status: result.jobStatus, conversion }, 200, requestId)
    }
    if (result.jobStatus === 'failed') {
      return jsonSuccess({ status: result.jobStatus, error: result.errorMessage }, 410, requestId)
    }
    return jsonSuccess({ status: result.jobStatus }, 202, requestId)
  } catch (error) {
    return mapErrorToResponse(error, requestId)
  }
}

/**
 * Handles POST /api/v1/jobs (create + enqueue), GET /api/v1/jobs/:id (poll
 * status), and GET /api/v1/jobs/:id/conversion (resolve to the job's
 * conversion result). All three require an authenticated caller (see
 * middleware/requireAuth.ts); GET routes additionally check the resource
 * belongs to that caller.
 */
export async function handleJobsRoute(request: Request, env: Env, requestId: string): Promise<Response> {
  const url = new URL(request.url)
  const segments = url.pathname.split('/').filter(Boolean) // ['api', 'v1', 'jobs', maybe ':id', maybe 'conversion']
  const jobId = segments[3]
  const subResource = segments[4]

  try {
    if (request.method === 'POST' && !jobId) {
      return await handleCreateJob(request, env, requestId)
    }
    if (request.method === 'GET' && jobId && subResource === 'conversion') {
      const { userId } = await requireAuth(request, env)
      return withNoStore(await handleGetJobConversion(jobId, userId, env, requestId))
    }
    if (request.method === 'GET' && jobId && !subResource) {
      const { userId } = await requireAuth(request, env)
      return withNoStore(await handleGetJob(jobId, userId, env, requestId))
    }
  } catch (error) {
    if (error instanceof UnauthorizedError) return mapErrorToResponse(error, requestId)
    throw error
  }
  return jsonError('VALIDATION_ERROR', 'Method not allowed', 405, requestId)
}
