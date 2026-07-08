// Local smoke test for GET /api/v1/conversions, GET /api/v1/conversions/:id,
// and GET /api/v1/jobs/:id/conversion — calls the real route handlers
// directly with a fake Env, driving a job all the way through the real
// queue() consumer to get a genuinely completed conversion, no wrangler dev
// needed. Auth uses the dev-only X-Test-User-Id bypass (see
// middleware/requireAuth.ts).
//
// Run with: npx tsx src/routes/conversions.smoke-test.ts (from inside backend/)
import worker from '../index'
import { handleUploadsRoute } from './uploads'
import { handleJobsRoute } from './jobs'
import { handleConversionsRoute } from './conversions'
import { createJobService } from '../services/JobService'
import { createCreditsService } from '../services/CreditsService'
import { loadDecoderWasmModules, createTestPng } from '../testSupport/wasmTestFixtures'
import { readSuccessBody, readErrorBody, TEST_REQUEST_ID } from '../testSupport/apiTestHelpers'
import type { Env } from '../env'
import type { R2Bucket, Queue, Message, MessageBatch } from '@cloudflare/workers-types'
import type { ConversionQueueMessage } from '../integrations/queue'

function assertEqual<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
  }
}

function assertTrue(condition: boolean, message: string): void {
  if (!condition) throw new Error(message)
}

function arrayBufferToStream(buffer: ArrayBuffer): ReadableStream {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(buffer))
      controller.close()
    },
  })
}

async function createFakeEnv(): Promise<Env> {
  const store = new Map<string, ArrayBuffer>()
  const bucket = {
    async put(key: string, value: ArrayBuffer) {
      store.set(key, value)
      return null
    },
    async get(key: string) {
      const value = store.get(key)
      return value ? ({ body: arrayBufferToStream(value) } as never) : null
    },
    async delete(key: string) {
      store.delete(key)
    },
  } as unknown as R2Bucket

  const queue = {
    async send() {},
    async sendBatch() {},
  } as unknown as Queue<ConversionQueueMessage>

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

function createFakeMessage(body: ConversionQueueMessage): Message<ConversionQueueMessage> {
  return {
    id: 'fake-message-id',
    timestamp: new Date(),
    body,
    attempts: 1,
    ack() {},
    retry() {},
  } as unknown as Message<ConversionQueueMessage>
}

function createFakeBatch(messages: Message<ConversionQueueMessage>[]): MessageBatch<ConversionQueueMessage> {
  return {
    messages,
    queue: 'vectorla-conversions',
    metadata: {} as never,
    retryAll() {},
    ackAll() {},
  } as unknown as MessageBatch<ConversionQueueMessage>
}

async function runJobToCompletion(env: Env, jobId: string): Promise<void> {
  if (!worker.queue) throw new Error('worker.queue is not defined')
  await worker.queue(createFakeBatch([createFakeMessage({ jobId })]), env)
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

function authedRequest(userId: string | null, path: string): Request {
  const headers: Record<string, string> = {}
  if (userId) headers['X-Test-User-Id'] = userId
  return new Request(`http://localhost/api/v1${path}`, { method: 'GET', headers })
}

async function run() {
  const env = await createFakeEnv()

  // ConversionService.processJob (Phase 15) now enforces credits before
  // vectorizing — grant both test users enough to cover their conversions.
  const creditsService = createCreditsService(env)
  await creditsService.grantMonthlyCredits('conv-user', 'free')
  await creditsService.grantMonthlyCredits('conv-user-2', 'free')

  // Seed a completed job + conversion via the real upload -> queue pipeline.
  // Phase 19: the queue consumer now really decodes+traces this file, so it
  // must be a genuinely valid PNG, not just a placeholder.
  const file = new File([await createTestPng()], 'logo.png', { type: 'image/png' })
  const uploadRes = await handleUploadsRoute(makeUploadRequest('conv-user', { file }), env, TEST_REQUEST_ID)
  const { job: completedJob } = await readSuccessBody<{ job: { id: string } }>(uploadRes)
  await runJobToCompletion(env, completedJob.id)

  // 1. GET /jobs/:id/conversion — completed conversion (200 + download URL)
  const jobConversionRes = await handleJobsRoute(
    authedRequest('conv-user', `/jobs/${completedJob.id}/conversion`),
    env,
    TEST_REQUEST_ID,
  )
  assertEqual(jobConversionRes.status, 200, 'status for GET /jobs/:id/conversion (completed)')
  const jobConversionBody = await readSuccessBody<{
    status: string
    conversion: { id: string; downloadUrl: string | null }
  }>(jobConversionRes)
  assertEqual(jobConversionBody.status, 'completed', 'data.status for completed job')
  assertTrue(Boolean(jobConversionBody.conversion.downloadUrl), 'data.conversion.downloadUrl is present')
  assertEqual(
    (jobConversionBody.conversion as unknown as { storageKey?: string }).storageKey,
    undefined,
    'Security (Phase 17): raw R2 storageKey must never be exposed in the API response',
  )
  console.log('PASS: 200 OK for GET /api/v1/jobs/:id/conversion once completed, with a download URL')

  // 401 — no auth
  const jobConversionUnauthedRes = await handleJobsRoute(
    authedRequest(null, `/jobs/${completedJob.id}/conversion`),
    env,
    TEST_REQUEST_ID,
  )
  assertEqual(jobConversionUnauthedRes.status, 401, 'status for GET /jobs/:id/conversion with no auth')
  console.log('PASS: 401 Unauthorized for GET /api/v1/jobs/:id/conversion with no auth')

  // 403 — a different authenticated user than the job's owner
  const jobConversionForbiddenRes = await handleJobsRoute(
    authedRequest('someone-else', `/jobs/${completedJob.id}/conversion`),
    env,
    TEST_REQUEST_ID,
  )
  assertEqual(jobConversionForbiddenRes.status, 403, 'status for GET /jobs/:id/conversion as another user')
  console.log('PASS: 403 Forbidden for GET /api/v1/jobs/:id/conversion when the job belongs to another user')

  const conversionId = jobConversionBody.conversion.id
  const getConversionRes = await handleConversionsRoute(authedRequest('conv-user', `/conversions/${conversionId}`), env, TEST_REQUEST_ID)
  assertEqual(getConversionRes.status, 200, 'status for GET /conversions/:id')
  const conversionBody = await readSuccessBody<{ id: string; downloadUrl: string | null }>(getConversionRes)
  assertEqual(conversionBody.id, conversionId, 'GET /conversions/:id returns the right conversion')
  assertTrue(Boolean(conversionBody.downloadUrl), 'GET /conversions/:id attaches a downloadUrl')
  assertEqual(
    (conversionBody as unknown as { storageKey?: string }).storageKey,
    undefined,
    'Security (Phase 17): raw R2 storageKey must never be exposed in the API response',
  )
  console.log('PASS: 200 OK for GET /api/v1/conversions/:id with a download URL')

  // 401 — no auth
  const getConversionUnauthedRes = await handleConversionsRoute(authedRequest(null, `/conversions/${conversionId}`), env, TEST_REQUEST_ID)
  assertEqual(getConversionUnauthedRes.status, 401, 'status for GET /conversions/:id with no auth')
  console.log('PASS: 401 Unauthorized for GET /api/v1/conversions/:id with no auth')

  // 403 — a different authenticated user than the conversion's owner
  const getConversionForbiddenRes = await handleConversionsRoute(
    authedRequest('someone-else', `/conversions/${conversionId}`),
    env,
    TEST_REQUEST_ID,
  )
  assertEqual(getConversionForbiddenRes.status, 403, 'status for GET /conversions/:id as another user')
  console.log('PASS: 403 Forbidden for GET /api/v1/conversions/:id when the conversion belongs to another user')

  // 2. GET /conversions/:id — unknown id (404)
  const missingConversionRes = await handleConversionsRoute(authedRequest('conv-user', '/conversions/does-not-exist'), env, TEST_REQUEST_ID)
  assertEqual(missingConversionRes.status, 404, 'status for unknown conversion id')
  assertEqual((await readErrorBody(missingConversionRes)).code, 'NOT_FOUND', 'error code for unknown conversion id')
  console.log('PASS: 404 Not Found for GET /api/v1/conversions/:id with an unknown id')

  // 2b. GET /conversions (Phase 21: new paginated list endpoint)
  const listRes = await handleConversionsRoute(authedRequest('conv-user', '/conversions'), env, TEST_REQUEST_ID)
  assertEqual(listRes.status, 200, 'status for GET /conversions (list)')
  const listBody = (await listRes.json()) as {
    success: boolean
    data: { id: string }[]
    pagination: { total: number; limit: number; offset: number; hasMore: boolean }
  }
  assertEqual(listBody.success, true, 'list response is a success envelope')
  assertEqual(listBody.data.length, 1, 'conv-user has exactly one completed conversion')
  assertEqual(listBody.data[0]?.id, conversionId, 'the listed conversion matches')
  assertEqual(listBody.pagination.total, 1, 'pagination.total reflects the full count')
  assertEqual(listBody.pagination.hasMore, false, 'no more pages')
  console.log('PASS: 200 OK for GET /api/v1/conversions (paginated list)')

  const emptyListRes = await handleConversionsRoute(authedRequest('nobody-user', '/conversions'), env, TEST_REQUEST_ID)
  const emptyListBody = (await emptyListRes.json()) as { data: unknown[]; pagination: { total: number } }
  assertEqual(emptyListBody.data.length, 0, 'a user with no conversions gets an empty list, not an error')
  assertEqual(emptyListBody.pagination.total, 0, 'pagination.total is 0 for an empty list')
  console.log('PASS: GET /api/v1/conversions returns an empty page for a user with no conversions')

  // 3. GET /jobs/:id/conversion — queued/processing job (202, status only)
  const jobService = createJobService(env)
  const uploadRes2 = await handleUploadsRoute(makeUploadRequest('conv-user-2', { file }), env, TEST_REQUEST_ID)
  const { job: pendingJob } = await readSuccessBody<{ job: { id: string } }>(uploadRes2)
  const pendingRes = await handleJobsRoute(authedRequest('conv-user-2', `/jobs/${pendingJob.id}/conversion`), env, TEST_REQUEST_ID)
  assertEqual(pendingRes.status, 202, 'status for GET /jobs/:id/conversion (queued)')
  const pendingBody = await readSuccessBody<{ status: string; conversion?: unknown }>(pendingRes)
  assertEqual(pendingBody.status, 'queued', 'data.status for a queued job')
  assertEqual(pendingBody.conversion, undefined, 'no conversion field for a queued job')
  console.log('PASS: 202 Accepted for GET /api/v1/jobs/:id/conversion while queued/processing')

  // 4. GET /jobs/:id/conversion — failed job (410, error info, still success envelope)
  await jobService.markFailed(pendingJob.id, 'simulated vectorization failure')
  const failedRes = await handleJobsRoute(authedRequest('conv-user-2', `/jobs/${pendingJob.id}/conversion`), env, TEST_REQUEST_ID)
  assertEqual(failedRes.status, 410, 'status for GET /jobs/:id/conversion (failed)')
  const failedBody = await readSuccessBody<{ status: string; error: string | null }>(failedRes)
  assertEqual(failedBody.status, 'failed', 'data.status for a failed job')
  assertEqual(failedBody.error, 'simulated vectorization failure', 'data.error surfaces the failure reason')
  console.log('PASS: 410 for GET /api/v1/jobs/:id/conversion once the job has failed (still a success envelope)')

  // 5. GET /jobs/:id/conversion — unknown job (404)
  const missingJobConversionRes = await handleJobsRoute(authedRequest('conv-user', '/jobs/does-not-exist/conversion'), env, TEST_REQUEST_ID)
  assertEqual(missingJobConversionRes.status, 404, 'status for GET /jobs/:id/conversion with an unknown job')
  console.log('PASS: 404 Not Found for GET /api/v1/jobs/:id/conversion with an unknown job id')

  console.log('\nAll conversion retrieval route smoke tests passed.')
}

run().catch((error: unknown) => {
  console.error('Smoke test failed:', error)
  throw error
})
