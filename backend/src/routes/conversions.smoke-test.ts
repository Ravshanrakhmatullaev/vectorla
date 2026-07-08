// Local smoke test for GET /api/conversions/:id and GET /api/jobs/:id/conversion
// — calls the real route handlers directly with a fake Env, driving a job all
// the way through the real queue() consumer to get a genuinely completed
// conversion, no wrangler dev needed.
//
// Run with: npx tsx src/routes/conversions.smoke-test.ts (from inside backend/)
import worker from '../index'
import { handleUploadsRoute } from './uploads'
import { handleJobsRoute } from './jobs'
import { handleConversionsRoute } from './conversions'
import { createJobService } from '../services/JobService'
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

function toArrayBuffer(text: string): ArrayBuffer {
  return new TextEncoder().encode(text).buffer as ArrayBuffer
}

function createFakeEnv(): Env {
  const store = new Map<string, ArrayBuffer>()
  const bucket = {
    async put(key: string, value: ArrayBuffer) {
      store.set(key, value)
      return null
    },
    async get() {
      return null
    },
    async delete(key: string) {
      store.delete(key)
    },
  } as unknown as R2Bucket

  const queue = {
    async send() {},
    async sendBatch() {},
  } as unknown as Queue<ConversionQueueMessage>

  return {
    UPLOADS_BUCKET: bucket,
    CONVERSION_QUEUE: queue,
    SUPABASE_URL: '',
    SUPABASE_SERVICE_ROLE_KEY: '',
    DOWNLOAD_URL_SECRET: 'test-secret',
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

function makeUploadRequest(fields: Record<string, string | File>): Request {
  const form = new FormData()
  for (const [key, value] of Object.entries(fields)) form.append(key, value)
  return new Request('http://localhost/api/uploads', { method: 'POST', body: form })
}

async function run() {
  const env = createFakeEnv()

  // Seed a completed job + conversion via the real upload -> queue pipeline.
  const file = new File([toArrayBuffer('bytes')], 'logo.png', { type: 'image/png' })
  const uploadRes = await handleUploadsRoute(makeUploadRequest({ file, userId: 'conv-user' }), env)
  const { job: completedJob } = (await uploadRes.json()) as { job: { id: string } }
  await runJobToCompletion(env, completedJob.id)

  // 1. GET /api/conversions/:id — completed conversion (200 + download URL)
  const jobConversionRes = await handleJobsRoute(
    new Request(`http://localhost/api/jobs/${completedJob.id}/conversion`, { method: 'GET' }),
    env,
  )
  assertEqual(jobConversionRes.status, 200, 'status for GET /api/jobs/:id/conversion (completed)')
  const jobConversionBody = (await jobConversionRes.json()) as {
    status: string
    conversion: { id: string; downloadUrl: string | null }
  }
  assertEqual(jobConversionBody.status, 'completed', 'body.status for completed job')
  assertTrue(Boolean(jobConversionBody.conversion.downloadUrl), 'body.conversion.downloadUrl is present')
  console.log('PASS: 200 OK for GET /api/jobs/:id/conversion once completed, with a download URL')

  const conversionId = jobConversionBody.conversion.id
  const getConversionRes = await handleConversionsRoute(
    new Request(`http://localhost/api/conversions/${conversionId}`, { method: 'GET' }),
    env,
  )
  assertEqual(getConversionRes.status, 200, 'status for GET /api/conversions/:id')
  const conversionBody = (await getConversionRes.json()) as { id: string; downloadUrl: string | null }
  assertEqual(conversionBody.id, conversionId, 'GET /api/conversions/:id returns the right conversion')
  assertTrue(Boolean(conversionBody.downloadUrl), 'GET /api/conversions/:id attaches a downloadUrl')
  console.log('PASS: 200 OK for GET /api/conversions/:id with a download URL')

  // 2. GET /api/conversions/:id — unknown id (404)
  const missingConversionRes = await handleConversionsRoute(
    new Request('http://localhost/api/conversions/does-not-exist', { method: 'GET' }),
    env,
  )
  assertEqual(missingConversionRes.status, 404, 'status for unknown conversion id')
  console.log('PASS: 404 Not Found for GET /api/conversions/:id with an unknown id')

  // 3. GET /api/jobs/:id/conversion — queued/processing job (202, status only)
  const jobService = createJobService(env)
  const uploadRes2 = await handleUploadsRoute(makeUploadRequest({ file, userId: 'conv-user-2' }), env)
  const { job: pendingJob } = (await uploadRes2.json()) as { job: { id: string } }
  const pendingRes = await handleJobsRoute(
    new Request(`http://localhost/api/jobs/${pendingJob.id}/conversion`, { method: 'GET' }),
    env,
  )
  assertEqual(pendingRes.status, 202, 'status for GET /api/jobs/:id/conversion (queued)')
  const pendingBody = (await pendingRes.json()) as { status: string; conversion?: unknown }
  assertEqual(pendingBody.status, 'queued', 'body.status for a queued job')
  assertEqual(pendingBody.conversion, undefined, 'no conversion field for a queued job')
  console.log('PASS: 202 Accepted for GET /api/jobs/:id/conversion while queued/processing')

  // 4. GET /api/jobs/:id/conversion — failed job (410, error info)
  await jobService.markFailed(pendingJob.id, 'simulated vectorization failure')
  const failedRes = await handleJobsRoute(
    new Request(`http://localhost/api/jobs/${pendingJob.id}/conversion`, { method: 'GET' }),
    env,
  )
  assertEqual(failedRes.status, 410, 'status for GET /api/jobs/:id/conversion (failed)')
  const failedBody = (await failedRes.json()) as { status: string; error: string | null }
  assertEqual(failedBody.status, 'failed', 'body.status for a failed job')
  assertEqual(failedBody.error, 'simulated vectorization failure', 'body.error surfaces the failure reason')
  console.log('PASS: 410 Gone for GET /api/jobs/:id/conversion once the job has failed')

  // 5. GET /api/jobs/:id/conversion — unknown job (404)
  const missingJobConversionRes = await handleJobsRoute(
    new Request('http://localhost/api/jobs/does-not-exist/conversion', { method: 'GET' }),
    env,
  )
  assertEqual(missingJobConversionRes.status, 404, 'status for GET /api/jobs/:id/conversion with an unknown job')
  console.log('PASS: 404 Not Found for GET /api/jobs/:id/conversion with an unknown job id')

  console.log('\nAll conversion retrieval route smoke tests passed.')
}

run().catch((error: unknown) => {
  console.error('Smoke test failed:', error)
  throw error
})
