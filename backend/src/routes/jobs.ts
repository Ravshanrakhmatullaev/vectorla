import type { Env } from '../env'
import { createJobService } from '../services/JobService'
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

/** Handles POST /api/jobs (create + enqueue) and GET /api/jobs/:id (poll status). */
export async function handleJobsRoute(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url)
  const segments = url.pathname.split('/').filter(Boolean) // ['api', 'jobs', maybe ':id']
  const jobId = segments[2]

  if (request.method === 'POST' && !jobId) {
    return handleCreateJob(request, env)
  }
  if (request.method === 'GET' && jobId) {
    return handleGetJob(jobId, env)
  }
  return jsonResponse({ error: 'Method not allowed' }, 405)
}
