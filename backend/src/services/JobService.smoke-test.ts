// Local smoke test for JobService — exercises the real service against
// in-memory fakes for the jobs/uploads repositories and the queue client.
//
// Run with: npx tsx src/services/JobService.smoke-test.ts (from inside backend/)
import { JobService } from './JobService'
import { QueueService } from './QueueService'
import { CreditsService } from './CreditsService'
import { InMemoryJobsRepository } from '../repositories/InMemoryJobsRepository'
import { InMemoryUploadsRepository } from '../repositories/InMemoryUploadsRepository'
import { InMemoryCreditsRepository } from '../repositories/InMemoryCreditsRepository'
import type { QueueClient, ConversionQueueMessage } from '../integrations/queue'
import type { Upload } from '../types'

function assertEqual<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
  }
}

function assertTrue(condition: boolean, message: string): void {
  if (!condition) throw new Error(message)
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

  // 1b. Duplicate/idempotent job creation (Phase 18): a second request while
  // the first is still active (queued) returns that job unchanged instead of
  // creating (and re-enqueueing) a duplicate.
  const duplicate = await service.createJob({ userId: 'user-1', uploadId: 'upload-1', preset: 'ignored-preset' })
  assertEqual(duplicate.id, job.id, 'a duplicate request returns the existing active job')
  assertEqual(duplicate.preset, null, "the duplicate request's preset is ignored — the original job is unchanged")
  assertEqual(queueClient.sent.length, 1, 'no second message is enqueued for the duplicate request')
  console.log('PASS: createJob ignores a duplicate request while a job is still active for the upload')

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

  // 7. Optimistic locking (Phase 18): two concurrent markProcessing calls on
  // the same job — exactly one must win; the other must see a conflict
  // rather than silently clobbering the winner's update.
  const job3 = await service.createJob({ userId: 'user-1', uploadId: 'upload-1' })
  const outcomes = await Promise.allSettled([service.markProcessing(job3.id), service.markProcessing(job3.id)])
  const fulfilled = outcomes.filter((outcome) => outcome.status === 'fulfilled')
  const rejected = outcomes.filter((outcome) => outcome.status === 'rejected')
  assertEqual(fulfilled.length, 1, 'exactly one concurrent markProcessing call succeeds')
  assertEqual(rejected.length, 1, 'exactly one concurrent markProcessing call is rejected as a conflict')
  const [firstRejected] = rejected
  const rejectionMessage =
    firstRejected?.status === 'rejected' && firstRejected.reason instanceof Error ? firstRejected.reason.message : ''
  assertTrue(/modified concurrently/.test(rejectionMessage), 'the losing call fails with a conflict, not a silent overwrite')
  console.log('PASS: concurrent job status transitions are optimistically locked — only one wins')

  // 8. Phase 26: supersedesJobId refunds a completed job's debit before a
  // replacement job is created — e.g. switching Quick Trace -> Professional
  // Trace after Quick already finished must not stack charges.
  const creditsRepo = new InMemoryCreditsRepository()
  const creditsService = new CreditsService(creditsRepo)
  const serviceWithCredits = new JobService(jobsRepo, uploadsRepo, queueService, creditsService)

  await seedUpload(uploadsRepo, { id: 'upload-2', userId: 'user-2' })
  await creditsService.grantMonthlyCredits('user-2', 'free')

  const quickJob = await serviceWithCredits.createJob({ userId: 'user-2', uploadId: 'upload-2' })
  await serviceWithCredits.markProcessing(quickJob.id)
  await creditsService.debitCredits('user-2', 1, 'Quick Trace conversion', quickJob.id)
  await serviceWithCredits.markCompleted(quickJob.id)
  assertEqual((await creditsService.getBalance('user-2')).balance, 9, 'balance after the Quick Trace debit')

  const professionalJob = await serviceWithCredits.createJob({
    userId: 'user-2',
    uploadId: 'upload-2',
    preset: 'professional',
    supersedesJobId: quickJob.id,
  })
  assertTrue(professionalJob.id !== quickJob.id, 'supersedesJobId still creates a distinct new job')
  assertEqual(
    (await creditsService.getBalance('user-2')).balance,
    10,
    "the superseded Quick Trace job's debit is refunded before the new job is created",
  )
  console.log('PASS: createJob refunds a superseded completed job\'s debit before creating the replacement job')

  // 8b. Idempotent: re-requesting with the same supersedesJobId (e.g. a
  // client retry) must not refund twice.
  await serviceWithCredits.markFailed(professionalJob.id, 'simulated: forcing upload-2 back to no-active-job so a third createJob is possible')
  await serviceWithCredits.createJob({
    userId: 'user-2',
    uploadId: 'upload-2',
    preset: 'professional',
    supersedesJobId: quickJob.id,
  })
  assertEqual((await creditsService.getBalance('user-2')).balance, 10, 'a repeated supersedesJobId does not refund a second time')
  console.log('PASS: refundJobDebit (via supersedesJobId) is idempotent — no double refund')

  // 8c. supersedesJobId is silently ignored (not honored, not an error) if
  // the referenced job belongs to a different user.
  await seedUpload(uploadsRepo, { id: 'upload-3', userId: 'user-3' })
  await creditsService.grantMonthlyCredits('user-3', 'free')
  await serviceWithCredits.createJob({ userId: 'user-3', uploadId: 'upload-3', supersedesJobId: quickJob.id })
  assertEqual((await creditsService.getBalance('user-2')).balance, 10, "user-2's balance is untouched by user-3's (ignored) supersedesJobId")
  console.log('PASS: supersedesJobId referencing a job owned by a different user is silently ignored, not honored')

  console.log('\nAll JobService smoke tests passed.')
}

run().catch((error: unknown) => {
  console.error('Smoke test failed:', error)
  throw error
})
