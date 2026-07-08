import type { Env } from '../env'
import { createJobService } from '../services/JobService'
import { createConversionService } from '../services/ConversionService'
import { NotFoundError, ValidationError } from '../errors'

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

interface CreateJobBody {
  userId?: unknown
  uploadId?: unknown
  preset?: unknown
  settings?: unknown
}

function isRecordOfNumbers(value: unknown): value is Record<string, number> {
  if (typeof value !== 'object' || value === null) return false
  return Object.values(value).every((v) => typeof v === 'number')
}

async function handleCreateJob(request: Request, env: Env): Promise<Response> {
  let body: CreateJobBody
  try {
    body = (await request.json()) as CreateJobBody
  } catch {
    return jsonResponse({ error: 'Expected a JSON body' }, 400)
  }

  if (typeof body.userId !== 'string' || body.userId.length === 0) {
    return jsonResponse({ error: 'Missing "userId" field' }, 400)
  }
  if (typeof body.uploadId !== 'string' || body.uploadId.length === 0) {
    return jsonResponse({ error: 'Missing "uploadId" field' }, 400)
  }

  try {
    const jobService = createJobService(env)
    const job = await jobService.createJob({
      userId: body.userId,
      uploadId: body.uploadId,
      preset: typeof body.preset === 'string' ? body.preset : undefined,
      settings: isRecordOfNumbers(body.settings) ? body.settings : undefined,
    })
    return jsonResponse(job, 201)
  } catch (error) {
    if (error instanceof ValidationError) return jsonResponse({ error: error.message }, 400)
    console.error('Unexpected error in POST /api/jobs:', error)
    return jsonResponse({ error: 'Internal Server Error' }, 500)
  }
}

async function handleGetJob(jobId: string, env: Env): Promise<Response> {
  try {
    const jobService = createJobService(env)
    const job = await jobService.getJob(jobId)
    return jsonResponse(job, 200)
  } catch (error) {
    if (error instanceof NotFoundError) return jsonResponse({ error: error.message }, 404)
    console.error('Unexpected error in GET /api/jobs/:id:', error)
    return jsonResponse({ error: 'Internal Server Error' }, 500)
  }
}

/**
 * GET /api/jobs/:id/conversion — maps the job's current state to an HTTP
 * status: 200 once the conversion is ready (with a download URL), 202 while
 * still queued/processing, 410 if the job failed (won't ever produce one),
 * 404 if the job itself doesn't exist.
 */
async function handleGetJobConversion(jobId: string, env: Env): Promise<Response> {
  try {
    const conversionService = createConversionService(env)
    const result = await conversionService.getConversionByJob(jobId)

    if (result.jobStatus === 'completed') {
      return jsonResponse({ status: result.jobStatus, conversion: result.conversion }, 200)
    }
    if (result.jobStatus === 'failed') {
      return jsonResponse({ status: result.jobStatus, error: result.errorMessage }, 410)
    }
    return jsonResponse({ status: result.jobStatus }, 202)
  } catch (error) {
    if (error instanceof NotFoundError) return jsonResponse({ error: error.message }, 404)
    console.error('Unexpected error in GET /api/jobs/:id/conversion:', error)
    return jsonResponse({ error: 'Internal Server Error' }, 500)
  }
}

/**
 * Handles POST /api/jobs (create + enqueue), GET /api/jobs/:id (poll status),
 * and GET /api/jobs/:id/conversion (resolve to the job's conversion result).
 */
export async function handleJobsRoute(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url)
  const segments = url.pathname.split('/').filter(Boolean) // ['api', 'jobs', maybe ':id', maybe 'conversion']
  const jobId = segments[2]
  const subResource = segments[3]

  if (request.method === 'POST' && !jobId) {
    return handleCreateJob(request, env)
  }
  if (request.method === 'GET' && jobId && subResource === 'conversion') {
    return handleGetJobConversion(jobId, env)
  }
  if (request.method === 'GET' && jobId && !subResource) {
    return handleGetJob(jobId, env)
  }
  return jsonResponse({ error: 'Method not allowed' }, 405)
}
