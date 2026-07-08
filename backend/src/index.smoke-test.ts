// Local smoke test for the Worker's queue() consumer — verifies the
// queued -> processing -> completed state machine (no AI runs here, per
// Phase 10's explicit scope) using a fake MessageBatch, no wrangler dev needed.
//
// Run with: npx tsx src/index.smoke-test.ts (from inside backend/)
import worker from './index'
import { createJobService } from './services/JobService'
import { createUploadsRepository } from './repositories/createUploadsRepository'
import type { Env } from './env'
import type { R2Bucket, Queue, Message, MessageBatch } from '@cloudflare/workers-types'
import type { ConversionQueueMessage } from './integrations/queue'

function assertEqual<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
  }
}

function createFakeEnv(): Env {
  const bucket = {
    async put() {
      return null
    },
    async get() {
      return null
    },
    async delete() {},
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

  const env = createFakeEnv()
  const jobService = createJobService(env)

  // Seed a queued job directly via JobService (bypassing the upload flow —
  // this test only cares about the consumer's state machine).
  // The uploads repository shares the same in-memory store within this env,
  // so createJob's existence check needs a matching upload to exist first.
  const uploads = createUploadsRepository(env)
  await uploads.create({
    id: 'upload-1',
    userId: 'user-1',
    originalFileName: 'logo.png',
    mimeType: 'image/png',
    sizeBytes: 10,
    storageKey: 'uploads/user-1/upload-1/logo.png',
    status: 'stored',
    createdAt: new Date().toISOString(),
  })
  const job = await jobService.createJob({ userId: 'user-1', uploadId: 'upload-1' })
  assertEqual(job.status, 'queued', 'seeded job starts queued')

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

  console.log('\nAll queue() consumer smoke tests passed.')
}

run().catch((error: unknown) => {
  console.error('Smoke test failed:', error)
  throw error
})
