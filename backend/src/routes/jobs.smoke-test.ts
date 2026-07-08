// Local smoke test for POST /api/v1/jobs, GET /api/v1/jobs/:id — calls the
// real route handler directly with a fake Env, no wrangler dev needed. Auth
// uses the dev-only X-Test-User-Id bypass (see middleware/requireAuth.ts).
//
// Run with: npx tsx src/routes/jobs.smoke-test.ts (from inside backend/)
import { handleJobsRoute } from './jobs'
import { handleUploadsRoute } from './uploads'
import { loadDecoderWasmModules } from '../testSupport/wasmTestFixtures'
import { readSuccessBody, readErrorBody, TEST_REQUEST_ID } from '../testSupport/apiTestHelpers'
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

async function createFakeEnv(): Promise<Env> {
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

  // This test never drives a job through the queue consumer (no real
  // decoding ever runs), but Env still requires real WebAssembly.Module
  // values — see testSupport/wasmTestFixtures.ts.
  const { png, jpeg, webp } = await loadDecoderWasmModules()

  return {
    UPLOADS_BUCKET: bucket,
    CONVERSION_QUEUE: queue,
    SUPABASE_URL: '',
    SUPABASE_SERVICE_ROLE_KEY: '',
    DOWNLOAD_URL_SECRET: 'test-secret',
    VECTORIZATION_PROVIDER: 'placeholder',
    PNG_DECODER_WASM: png,
    JPEG_DECODER_WASM: jpeg,
    WEBP_DECODER_WASM: webp,
    ENVIRONMENT: 'development',
  }
}

function makeUploadRequest(userId: string, fields: Record<string, string | File>): Request {
  const form = new FormData()
  for (const [key, value] of Object.entries(fields)) form.append(key, value)
  return new Request('http://localhost/api/v1/uploads', {
    method: 'POST',
    headers: { 'X-Test-User-Id': userId },
    body: form,
  })
}

function makeJobsRequest(userId: string | null, method: string, path: string, body?: unknown): Request {
  const headers: Record<string, string> = {}
  if (userId) headers['X-Test-User-Id'] = userId
  return new Request(`http://localhost/api/v1${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
}

async function run() {
  const env = await createFakeEnv()

  // Seed an upload the same way a real client would, via the real upload route.
  const file = new File([pngBytes()], 'jobs-route-test.png', { type: 'image/png' })
  const uploadRes = await handleUploadsRoute(makeUploadRequest('jobs-user', { file }), env, TEST_REQUEST_ID)
  const { upload, job: autoCreatedJob } = await readSuccessBody<{
    upload: { id: string }
    job: { id: string; status: string }
  }>(uploadRes)
  assertEqual(autoCreatedJob.status, 'queued', 'the upload auto-created a queued job')

  // 401 — no Authorization/X-Test-User-Id header
  const unauthedRes = await handleJobsRoute(makeJobsRequest(null, 'POST', '/jobs', { uploadId: upload.id }), env, TEST_REQUEST_ID)
  assertEqual(unauthedRes.status, 401, 'status for missing auth on POST /jobs')
  assertEqual((await readErrorBody(unauthedRes)).code, 'UNAUTHORIZED', 'error code for missing auth')
  console.log('PASS: 401 Unauthorized for POST /api/v1/jobs with no auth')

  // POST /jobs for an upload that already has an active (queued) job —
  // Phase 18: duplicate/accidental job requests are ignored, returning the
  // existing active job unchanged (not a second job with the new preset).
  const createRes = await handleJobsRoute(
    makeJobsRequest('jobs-user', 'POST', '/jobs', { uploadId: upload.id, preset: 'logo' }),
    env,
    TEST_REQUEST_ID,
  )
  assertEqual(createRes.status, 201, 'status for POST /jobs')
  const job = await readSuccessBody<{ id: string; status: string; preset: string | null }>(createRes)
  assertEqual(job.id, autoCreatedJob.id, 'a duplicate request returns the existing active job, not a new one')
  assertEqual(job.status, 'queued', 'returned job status')
  assertEqual(job.preset, null, "the duplicate request's preset is ignored — the original job is unchanged")
  console.log('PASS: 201 Created for POST /api/v1/jobs (duplicate active-job request ignored)')

  // 400 — missing uploadId
  const badCreateRes = await handleJobsRoute(makeJobsRequest('jobs-user', 'POST', '/jobs', {}), env, TEST_REQUEST_ID)
  assertEqual(badCreateRes.status, 400, 'status for missing uploadId')
  assertEqual((await readErrorBody(badCreateRes)).code, 'VALIDATION_ERROR', 'error code for missing uploadId')
  console.log('PASS: 400 Bad Request when "uploadId" is missing')

  // 400 — uploadId that doesn't exist
  const missingUploadRes = await handleJobsRoute(
    makeJobsRequest('jobs-user', 'POST', '/jobs', { uploadId: 'does-not-exist' }),
    env,
    TEST_REQUEST_ID,
  )
  assertEqual(missingUploadRes.status, 400, 'status for unknown uploadId')
  console.log('PASS: 400 Bad Request for an unknown uploadId')

  // 403 — uploadId belongs to a different authenticated user
  const otherUserRes = await handleJobsRoute(
    makeJobsRequest('someone-else', 'POST', '/jobs', { uploadId: upload.id }),
    env,
    TEST_REQUEST_ID,
  )
  assertEqual(otherUserRes.status, 403, 'status for uploadId owned by another user')
  assertEqual((await readErrorBody(otherUserRes)).code, 'FORBIDDEN', 'error code for upload owned by another user')
  console.log('PASS: 403 Forbidden for POST /api/v1/jobs when the upload belongs to another user')

  // GET /jobs/:id
  const getRes = await handleJobsRoute(makeJobsRequest('jobs-user', 'GET', `/jobs/${job.id}`), env, TEST_REQUEST_ID)
  assertEqual(getRes.status, 200, 'status for GET /jobs/:id')
  const fetchedJob = await readSuccessBody<{ id: string }>(getRes)
  assertEqual(fetchedJob.id, job.id, 'fetched job id matches')
  console.log('PASS: 200 OK for GET /api/v1/jobs/:id')

  // 401 — GET /jobs/:id with no auth
  const getUnauthedRes = await handleJobsRoute(makeJobsRequest(null, 'GET', `/jobs/${job.id}`), env, TEST_REQUEST_ID)
  assertEqual(getUnauthedRes.status, 401, 'status for GET /jobs/:id with no auth')
  console.log('PASS: 401 Unauthorized for GET /api/v1/jobs/:id with no auth')

  // 403 — GET /jobs/:id as a different user than the job's owner
  const getForbiddenRes = await handleJobsRoute(makeJobsRequest('someone-else', 'GET', `/jobs/${job.id}`), env, TEST_REQUEST_ID)
  assertEqual(getForbiddenRes.status, 403, 'status for GET /jobs/:id as a different user')
  console.log('PASS: 403 Forbidden for GET /api/v1/jobs/:id when the job belongs to another user')

  // 404 — unknown job id
  const notFoundRes = await handleJobsRoute(makeJobsRequest('jobs-user', 'GET', '/jobs/does-not-exist'), env, TEST_REQUEST_ID)
  assertEqual(notFoundRes.status, 404, 'status for unknown job id')
  assertEqual((await readErrorBody(notFoundRes)).code, 'NOT_FOUND', 'error code for unknown job id')
  console.log('PASS: 404 Not Found for an unknown job id')

  // 405 — DELETE not supported
  const wrongMethodRes = await handleJobsRoute(makeJobsRequest('jobs-user', 'DELETE', `/jobs/${job.id}`), env, TEST_REQUEST_ID)
  assertEqual(wrongMethodRes.status, 405, 'status for unsupported method')
  console.log('PASS: 405 Method Not Allowed for DELETE')

  console.log('\nAll /api/v1/jobs route smoke tests passed.')
}

run().catch((error: unknown) => {
  console.error('Smoke test failed:', error)
  throw error
})
