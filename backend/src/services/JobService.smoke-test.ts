// Local smoke test for JobService — exercises the real service against
// in-memory fakes for the jobs/uploads repositories and the queue client.
//
// Run with: npx tsx src/services/JobService.smoke-test.ts (from inside backend/)
import { JobService } from './JobService'
import { QueueService } from './QueueService'
import { InMemoryJobsRepository } from '../repositories/InMemoryJobsRepository'
import { InMemoryUploadsRepository } from '../repositories/InMemoryUploadsRepository'
import type { QueueClient, ConversionQueueMessage } from '../integrations/queue'
import type { Upload } from '../types'

function assertEqual<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
  }
}

async function assertRejects(fn: () => Promise<unknown>, pattern: RegExp, message: string): Promise<void> {
  try {
    await fn()
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    if (!pattern.test(msg)) throw new Error(`${message}: error "${msg}" did not match ${pattern}`)
    return
  }
  throw new Error(`${message}: expected the call to reject, but it resolved`)
}

function createFakeQueueClient(): QueueClient & { sent: ConversionQueueMessage[] } {
  const sent: ConversionQueueMessage[] = []
  return {
    sent,
    async send(message) {
      sent.push(message)
    },
  }
}

async function seedUpload(uploads: InMemoryUploadsRepository, overrides: Partial<Upload> = {}): Promise<Upload> {
  const upload: Upload = {
    id: 'upload-1',
    userId: 'user-1',
    originalFileName: 'logo.png',
    mimeType: 'image/png',
    sizeBytes: 100,
    storageKey: 'uploads/user-1/upload-1/logo.png',
    status: 'stored',
    createdAt: new Date().toISOString(),
    ...overrides,
  }
  return uploads.create(upload)
}

async function run() {
  const jobsRepo = new InMemoryJobsRepository()
  const uploadsRepo = new InMemoryUploadsRepository()
  const queueClient = createFakeQueueClient()
  const queueService = new QueueService(queueClient)
  const service = new JobService(jobsRepo, uploadsRepo, queueService)

  await seedUpload(uploadsRepo)

  // 1. Successful job creation enqueues it
  const job = await service.createJob({ userId: 'user-1', uploadId: 'upload-1' })
  assertEqual(job.status, 'queued', 'new job status')
  assertEqual(job.retryCount, 0, 'new job retryCount')
  assertEqual(queueClient.sent.length, 1, 'one message enqueued')
  assertEqual(queueClient.sent[0]?.jobId, job.id, 'enqueued message references the job id')
  console.log('PASS: createJob persists a queued job and enqueues it')

  // 2. Unknown upload rejected
  await assertRejects(
    () => service.createJob({ userId: 'user-1', uploadId: 'does-not-exist' }),
    /No upload found/,
    'unknown upload',
  )
  console.log('PASS: createJob rejects an unknown uploadId')

  // 3. Upload belonging to a different user rejected
  await assertRejects(
    () => service.createJob({ userId: 'someone-else', uploadId: 'upload-1' }),
    /does not belong to user/,
    'mismatched user',
  )
  console.log('PASS: createJob rejects an upload owned by a different user')

  // 4. getJob
  const fetched = await service.getJob(job.id)
  assertEqual(fetched.id, job.id, 'getJob returns the right job')
  console.log('PASS: getJob returns the created job')

  await assertRejects(() => service.getJob('missing-job'), /No job found/, 'missing job')
  console.log('PASS: getJob rejects an unknown job id')

  // 5. State machine: queued -> processing -> completed
  const processing = await service.markProcessing(job.id)
  assertEqual(processing.status, 'processing', 'status after markProcessing')

  const completed = await service.markCompleted(job.id)
  assertEqual(completed.status, 'completed', 'status after markCompleted')
  assertEqual(completed.completedAt !== null, true, 'completedAt is set')
  console.log('PASS: queued -> processing -> completed transitions work')

  // 6. Failure path increments retryCount
  const job2 = await service.createJob({ userId: 'user-1', uploadId: 'upload-1' })
  const failed = await service.markFailed(job2.id, 'simulated failure')
  assertEqual(failed.status, 'failed', 'status after markFailed')
  assertEqual(failed.errorMessage, 'simulated failure', 'errorMessage after markFailed')
  assertEqual(failed.retryCount, 1, 'retryCount incremented on failure')
  console.log('PASS: markFailed sets status/errorMessage and increments retryCount')

  console.log('\nAll JobService smoke tests passed.')
}

run().catch((error: unknown) => {
  console.error('Smoke test failed:', error)
  throw error
})
