// Local smoke test for the Worker's queue() consumer — verifies the
// queued -> processing -> completed state machine (no AI runs here, per
// Phase 10's explicit scope) using a fake MessageBatch, no wrangler dev needed.
//
// Run with: npx tsx src/index.smoke-test.ts (from inside backend/)
import worker from './index'
import { createJobService } from './services/JobService'
import { createCreditsService } from './services/CreditsService'
import { createUploadsRepository } from './repositories/createUploadsRepository'
import { loadDecoderWasmModules, createTestPng } from './testSupport/wasmTestFixtures'
import type { Env } from './env'
import type { R2Bucket, Queue, Message, MessageBatch } from '@cloudflare/workers-types'
import type { ConversionQueueMessage } from './integrations/queue'

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

function createFakeMessage(body: ConversionQueueMessage): Message<ConversionQueueMessage> & {
  acked: boolean
  retried: boolean
} {
  const state = { acked: false, retried: false }
  return {
    id: 'fake-message-id',
    timestamp: new Date(),
    body,
    attempts: 1,
    ack() {
      state.acked = true
    },
    retry() {
      state.retried = true
    },
    get acked() {
      return state.acked
    },
    get retried() {
      return state.retried
    },
  } as unknown as Message<ConversionQueueMessage> & { acked: boolean; retried: boolean }
}

function createFakeBatch(
  messages: (Message<ConversionQueueMessage> & { acked: boolean; retried: boolean })[],
): MessageBatch<ConversionQueueMessage> {
  return {
    messages,
    queue: 'vectorla-conversions',
    metadata: {} as never,
    retryAll() {},
    ackAll() {},
  } as unknown as MessageBatch<ConversionQueueMessage>
}

async function run() {
  if (!worker.queue) throw new Error('worker.queue is not defined')

  const env = await createFakeEnv()
  const jobService = createJobService(env)

  // Seed a queued job directly via JobService (bypassing the upload flow —
  // this test only cares about the consumer's state machine). The queue
  // consumer now runs a real decode+trace (Phase 19), so the R2 object at
  // this storage key must be a genuinely valid PNG, not just a placeholder.
  // The uploads repository shares the same in-memory store within this env,
  // so createJob's existence check needs a matching upload to exist first.
  const uploads = createUploadsRepository(env)
  const storageKey = 'uploads/user-1/upload-1/logo.png'
  await env.UPLOADS_BUCKET.put(storageKey, await createTestPng())
  await uploads.create({
    id: 'upload-1',
    userId: 'user-1',
    originalFileName: 'logo.png',
    mimeType: 'image/png',
    sizeBytes: 10,
    storageKey,
    status: 'stored',
    createdAt: new Date().toISOString(),
  })
  const job = await jobService.createJob({ userId: 'user-1', uploadId: 'upload-1' })
  assertEqual(job.status, 'queued', 'seeded job starts queued')

  // ConversionService.processJob (Phase 15) now enforces credits before
  // vectorizing — grant user-1 enough to cover the base conversion cost.
  const creditsService = createCreditsService(env)
  await creditsService.grantMonthlyCredits('user-1', 'free')

  // 1. Happy path: queued -> processing -> completed, message acked
  const message = createFakeMessage({ jobId: job.id })
  const batch = createFakeBatch([message])
  await worker.queue(batch, env)

  const afterSuccess = await jobService.getJob(job.id)
  assertEqual(afterSuccess.status, 'completed', 'job status after successful consume')
  assertEqual(afterSuccess.completedAt !== null, true, 'completedAt set after successful consume')
  assertEqual(message.acked, true, 'message.ack() called on success')
  assertEqual(message.retried, false, 'message.retry() not called on success')
  console.log('PASS: queue() consumer moves a job queued -> processing -> completed and acks the message')

  // 2. Failure path: a job id that doesn't exist should fail + retry, not throw
  const badMessage = createFakeMessage({ jobId: 'does-not-exist' })
  const badBatch = createFakeBatch([badMessage])
  await worker.queue(badBatch, env) // must not throw
  assertEqual(badMessage.retried, true, 'message.retry() called when the job lookup fails')
  assertEqual(badMessage.acked, false, 'message.ack() not called when the job lookup fails')
  console.log('PASS: queue() consumer retries (does not crash) when the job cannot be found')

  // 3. Insufficient credits: the job's user has a 0 balance (no grant), so
  // ConversionService.processJob throws InsufficientCreditsError, which the
  // consumer's catch block turns into a clear job failure (same path as any
  // other processing error) rather than a crash.
  await uploads.create({
    id: 'upload-2',
    userId: 'poor-user',
    originalFileName: 'logo2.png',
    mimeType: 'image/png',
    sizeBytes: 10,
    storageKey: 'uploads/poor-user/upload-2/logo2.png',
    status: 'stored',
    createdAt: new Date().toISOString(),
  })
  const poorJob = await jobService.createJob({ userId: 'poor-user', uploadId: 'upload-2' })
  const poorMessage = createFakeMessage({ jobId: poorJob.id })
  const poorBatch = createFakeBatch([poorMessage])
  await worker.queue(poorBatch, env) // must not throw

  const afterInsufficientCredits = await jobService.getJob(poorJob.id)
  assertEqual(afterInsufficientCredits.status, 'failed', 'job status when the user has insufficient credits')
  assertTrue(
    (afterInsufficientCredits.errorMessage ?? '').includes('credit'),
    'errorMessage mentions credits for the insufficient-credits failure',
  )
  assertEqual(poorMessage.retried, true, 'message.retry() called on insufficient credits')
  assertEqual(poorMessage.acked, false, 'message.ack() not called on insufficient credits')
  console.log('PASS: queue() consumer fails a job with a clear message when the user lacks enough credits')

  console.log('\nAll queue() consumer smoke tests passed.')
}

run().catch((error: unknown) => {
  console.error('Smoke test failed:', error)
  throw error
})
