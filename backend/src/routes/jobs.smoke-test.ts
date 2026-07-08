// Local smoke test for POST /api/jobs, GET /api/jobs/:id — calls the real
// route handler directly with a fake Env, no wrangler dev needed. Auth uses
// the dev-only X-Test-User-Id bypass (see middleware/requireAuth.ts).
//
// Run with: npx tsx src/routes/jobs.smoke-test.ts (from inside backend/)
import { handleJobsRoute } from './jobs'
import { handleUploadsRoute } from './uploads'
import type { Env } from '../env'
import type { R2Bucket, Queue } from '@cloudflare/workers-types'
import type { ConversionQueueMessage } from '../integrations/queue'

function assertEqual<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
  }
}

// Phase 17 added magic-byte signature validation (see validateUpload.ts) —
// fixtures declaring image/png must start with the real PNG signature.
function pngBytes(size = 16): ArrayBuffer {
  const buffer = new ArrayBuffer(Math.max(size, 8))
  new Uint8Array(buffer).set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  return buffer
}

function createFakeEnv(): Env {
  const store = new Map<string, ArrayBuffer>()
  const bucket: R2Bucket = {
    async put(key: string, value: ArrayBuffer) {
      store.set(key, value)
      return null
    },
    async get(key: string) {
      return store.has(key) ? ({ body: null } as never) : null
    },
    async delete(key: string) {
      store.delete(key)
    },
  } as unknown as R2Bucket

  const queue: Queue<ConversionQueueMessage> = {
    async send() {},
    async sendBatch() {},
  } as unknown as Queue<ConversionQueueMessage>

  return {
    UPLOADS_BUCKET: bucket,
    CONVERSION_QUEUE: queue,
    SUPABASE_URL: '',
    SUPABASE_SERVICE_ROLE_KEY: '',
    DOWNLOAD_URL_SECRET: 'test-secret',
    VECTORIZATION_PROVIDER: 'placeholder',
    ENVIRONMENT: 'development',
  }
}

function makeUploadRequest(userId: string, fields: Record<string, string | File>): Request {
  const form = new FormData()
  for (const [key, value] of Object.entries(fields)) form.append(key, value)
  return new Request('http://localhost/api/uploads', {
    method: 'POST',
    headers: { 'X-Test-User-Id': userId },
    body: form,
  })
}

function makeJobsRequest(userId: string | null, method: string, path: string, body?: unknown): Request {
  const headers: Record<string, string> = {}
  if (userId) headers['X-Test-User-Id'] = userId
  return new Request(`http://localhost${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
}

async function run() {
  const env = createFakeEnv()

  // Seed an upload the same way a real client would, via the real upload route.
  const file = new File([pngBytes()], 'jobs-route-test.png', { type: 'image/png' })
  const uploadRes = await handleUploadsRoute(makeUploadRequest('jobs-user', { file }), env)
  const { upload } = (await uploadRes.json()) as { upload: { id: string } }

  // 401 — no Authorization/X-Test-User-Id header
  const unauthedRes = await handleJobsRoute(makeJobsRequest(null, 'POST', '/api/jobs', { uploadId: upload.id }), env)
  assertEqual(unauthedRes.status, 401, 'status for missing auth on POST /api/jobs')
  console.log('PASS: 401 Unauthorized for POST /api/jobs with no auth')

  // POST /api/jobs — create another job for the same upload (e.g. re-processing)
  const createRes = await handleJobsRoute(
    makeJobsRequest('jobs-user', 'POST', '/api/jobs', { uploadId: upload.id, preset: 'logo' }),
    env,
  )
  assertEqual(createRes.status, 201, 'status for POST /api/jobs')
  const job = (await createRes.json()) as { id: string; status: string; preset: string }
  assertEqual(job.status, 'queued', 'created job status')
  assertEqual(job.preset, 'logo', 'created job preset')
  console.log('PASS: 201 Created for POST /api/jobs')

  // 400 — missing uploadId
  const badCreateRes = await handleJobsRoute(makeJobsRequest('jobs-user', 'POST', '/api/jobs', {}), env)
  assertEqual(badCreateRes.status, 400, 'status for missing uploadId')
  console.log('PASS: 400 Bad Request when "uploadId" is missing')

  // 400 — uploadId that doesn't exist
  const missingUploadRes = await handleJobsRoute(
    makeJobsRequest('jobs-user', 'POST', '/api/jobs', { uploadId: 'does-not-exist' }),
    env,
  )
  assertEqual(missingUploadRes.status, 400, 'status for unknown uploadId')
  console.log('PASS: 400 Bad Request for an unknown uploadId')

  // 403 — uploadId belongs to a different authenticated user
  const otherUserRes = await handleJobsRoute(
    makeJobsRequest('someone-else', 'POST', '/api/jobs', { uploadId: upload.id }),
    env,
  )
  assertEqual(otherUserRes.status, 403, 'status for uploadId owned by another user')
  console.log('PASS: 403 Forbidden for POST /api/jobs when the upload belongs to another user')

  // GET /api/jobs/:id
  const getRes = await handleJobsRoute(makeJobsRequest('jobs-user', 'GET', `/api/jobs/${job.id}`), env)
  assertEqual(getRes.status, 200, 'status for GET /api/jobs/:id')
  const fetchedJob = (await getRes.json()) as { id: string }
  assertEqual(fetchedJob.id, job.id, 'fetched job id matches')
  console.log('PASS: 200 OK for GET /api/jobs/:id')

  // 401 — GET /api/jobs/:id with no auth
  const getUnauthedRes = await handleJobsRoute(makeJobsRequest(null, 'GET', `/api/jobs/${job.id}`), env)
  assertEqual(getUnauthedRes.status, 401, 'status for GET /api/jobs/:id with no auth')
  console.log('PASS: 401 Unauthorized for GET /api/jobs/:id with no auth')

  // 403 — GET /api/jobs/:id as a different user than the job's owner
  const getForbiddenRes = await handleJobsRoute(makeJobsRequest('someone-else', 'GET', `/api/jobs/${job.id}`), env)
  assertEqual(getForbiddenRes.status, 403, 'status for GET /api/jobs/:id as a different user')
  console.log('PASS: 403 Forbidden for GET /api/jobs/:id when the job belongs to another user')

  // 404 — unknown job id
  const notFoundRes = await handleJobsRoute(makeJobsRequest('jobs-user', 'GET', '/api/jobs/does-not-exist'), env)
  assertEqual(notFoundRes.status, 404, 'status for unknown job id')
  console.log('PASS: 404 Not Found for an unknown job id')

  // 405 — DELETE not supported
  const wrongMethodRes = await handleJobsRoute(makeJobsRequest('jobs-user', 'DELETE', `/api/jobs/${job.id}`), env)
  assertEqual(wrongMethodRes.status, 405, 'status for unsupported method')
  console.log('PASS: 405 Method Not Allowed for DELETE')

  console.log('\nAll /api/jobs route smoke tests passed.')
}

run().catch((error: unknown) => {
  console.error('Smoke test failed:', error)
  throw error
})
