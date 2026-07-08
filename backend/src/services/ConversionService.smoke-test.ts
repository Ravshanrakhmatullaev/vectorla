// Local smoke test for ConversionService — exercises the full placeholder
// pipeline (load job/upload, mark processing, store SVG in R2, save
// conversion metadata, mark completed) plus the Phase 12 retrieval methods
// (getConversion, getConversionByJob, listUserConversions) and the
// self-signed download URL's expiry check, against in-memory fakes.
//
// Run with: npx tsx src/services/ConversionService.smoke-test.ts (from inside backend/)
import { ConversionService } from './ConversionService'
import { JobService } from './JobService'
import { QueueService } from './QueueService'
import { StorageService } from './StorageService'
import { InMemoryJobsRepository } from '../repositories/InMemoryJobsRepository'
import { InMemoryUploadsRepository } from '../repositories/InMemoryUploadsRepository'
import { InMemoryConversionsRepository } from '../repositories/InMemoryConversionsRepository'
import { InMemoryCreditsRepository } from '../repositories/InMemoryCreditsRepository'
import { CreditsService } from './CreditsService'
import { PlaceholderProvider } from '../providers/PlaceholderProvider'
import { loadDecoderWasmModules, createTestPng } from '../testSupport/wasmTestFixtures'
import type { QueueClient } from '../integrations/queue'
import type { R2Client } from '../integrations/r2'
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

function createFakeQueueClient(): QueueClient {
  return {
    async send() {},
  }
}

function createFakeR2Client(): R2Client & { objects: Map<string, ReadableStream | ArrayBuffer> } {
  const objects = new Map<string, ReadableStream | ArrayBuffer>()
  return {
    objects,
    async put(key, data) {
      objects.set(key, data)
    },
    async get(key) {
      const value = objects.get(key)
      if (!value) return null
      if (value instanceof ReadableStream) return value
      const buffer = value
      return new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array(buffer))
          controller.close()
        },
      })
    },
    async delete(key) {
      objects.delete(key)
    },
    async list(prefix) {
      return Array.from(objects.keys()).filter((key) => key.startsWith(prefix))
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
  const conversionsRepo = new InMemoryConversionsRepository()
  const creditsRepo = new InMemoryCreditsRepository()
  const creditsService = new CreditsService(creditsRepo)
  const queueService = new QueueService(createFakeQueueClient())
  const jobService = new JobService(jobsRepo, uploadsRepo, queueService)
  const r2 = createFakeR2Client()
  const storage = new StorageService(r2, 'test-secret')
  const wasm = await loadDecoderWasmModules()
  const service = new ConversionService(
    jobService,
    uploadsRepo,
    storage,
    conversionsRepo,
    new PlaceholderProvider(wasm),
    creditsService,
  )

  await seedUpload(uploadsRepo)
  // Phase 19: processJob now really decodes+traces this file, so it must be
  // a genuinely valid PNG, not just a placeholder.
  await r2.put('uploads/user-1/upload-1/logo.png', await createTestPng())
  await seedUpload(uploadsRepo, { id: 'upload-broke', userId: 'broke-user', storageKey: 'uploads/broke-user/upload-broke/logo.png' })

  // 0. Not enough credits: processJob rejects before vectorizing/storing/debiting
  const brokeJob = await jobService.createJob({ userId: 'broke-user', uploadId: 'upload-broke' })
  await assertRejects(() => service.processJob(brokeJob.id), /has 0 credits, needs 1/, 'insufficient credits')
  const brokeBalance = await creditsService.getBalance('broke-user')
  assertEqual(brokeBalance.balance, 0, 'balance untouched after an insufficient-credits rejection')
  assertEqual(
    (await creditsRepo.findTransactionsByUserId('broke-user')).length,
    0,
    'no transaction recorded after an insufficient-credits rejection',
  )
  assertEqual(
    await service.listUserConversions('broke-user').then((c) => c.length),
    0,
    'no conversion created after an insufficient-credits rejection',
  )
  console.log('PASS: processJob rejects when the user has insufficient credits, with no side effects')

  // Grant user-1 credits to cover the tests below (free plan: 10/mo).
  await creditsService.grantMonthlyCredits('user-1', 'free')
  const balanceAfterGrant = await creditsService.getBalance('user-1')
  assertEqual(balanceAfterGrant.balance, 10, 'grantMonthlyCredits credits the free plan amount')
  console.log('PASS: grantMonthlyCredits grants PLAN_LIMITS[plan].monthlyCredits')

  // 1. Happy path: full pipeline runs end-to-end, and credits are debited
  const job = await jobService.createJob({ userId: 'user-1', uploadId: 'upload-1' })
  const conversions = await service.processJob(job.id)

  const balanceAfterConversion = await creditsService.getBalance('user-1')
  assertEqual(balanceAfterConversion.balance, 9, 'processJob debits the base conversion cost on success')
  const transactions = await creditsRepo.findTransactionsByUserId('user-1')
  const debitTransaction = transactions.find((t) => t.type === 'debit')
  assertTrue(Boolean(debitTransaction), 'a debit transaction was recorded')
  assertEqual(debitTransaction?.amount, 1, 'debit transaction amount matches the base conversion cost')
  assertEqual(debitTransaction?.jobId, job.id, 'debit transaction references the job')
  console.log('PASS: processJob debits credits and records a transaction after a successful conversion')

  assertEqual(conversions.length, 1, 'processJob returns one conversion')
  const conversion = conversions[0]
  assertTrue(Boolean(conversion), 'conversion should be defined')
  assertEqual(conversion?.jobId, job.id, 'conversion references the job')
  assertEqual(conversion?.userId, 'user-1', 'conversion references the user')
  assertEqual(conversion?.format, 'svg', 'conversion format is svg')
  assertTrue((conversion?.fileSizeBytes ?? 0) > 0, 'conversion has a non-zero file size')
  assertTrue(r2.objects.has(conversion?.storageKey ?? ''), 'traced SVG stored in R2')
  console.log('PASS: processJob traces a real SVG and saves conversion metadata')

  const completedJob = await jobService.getJob(job.id)
  assertEqual(completedJob.status, 'completed', 'job status after processJob')
  assertTrue(completedJob.completedAt !== null, 'completedAt set after processJob')
  console.log('PASS: processJob marks the job completed')

  // 2. getConversion (completed) returns a fresh, valid, unexpired download URL
  const fetched = await service.getConversion(conversion?.id ?? '')
  assertEqual(fetched.id, conversion?.id, 'getConversion returns the right conversion')
  assertTrue(Boolean(fetched.downloadUrl), 'getConversion attaches a downloadUrl')
  const verification = await storage.verifySignedUrl(fetched.downloadUrl ?? '')
  assertEqual(verification.valid, true, 'attached downloadUrl verifies as valid')
  assertEqual(verification.expired, false, 'attached downloadUrl is not expired')
  console.log('PASS: getConversion (completed) returns a valid, unexpired download URL')

  await assertRejects(() => service.getConversion('missing-conversion'), /No conversion found/, 'missing conversion')
  console.log('PASS: getConversion rejects an unknown conversion id (404 case)')

  // 3. getConversionByJob (completed)
  const completedResult = await service.getConversionByJob(job.id)
  assertEqual(completedResult.jobStatus, 'completed', 'getConversionByJob status for completed job')
  assertTrue(Boolean(completedResult.conversion?.downloadUrl), 'getConversionByJob attaches a downloadUrl')
  console.log('PASS: getConversionByJob (completed) returns the conversion with a download URL')

  // 4. getConversionByJob (queued/processing) — status only, no conversion/downloadUrl
  const pendingJob = await jobService.createJob({ userId: 'user-1', uploadId: 'upload-1' })
  const queuedResult = await service.getConversionByJob(pendingJob.id)
  assertEqual(queuedResult.jobStatus, 'queued', 'getConversionByJob status for a queued job')
  assertEqual(queuedResult.conversion, null, 'no conversion for a queued job')

  await jobService.markProcessing(pendingJob.id)
  const processingResult = await service.getConversionByJob(pendingJob.id)
  assertEqual(processingResult.jobStatus, 'processing', 'getConversionByJob status for a processing job')
  assertEqual(processingResult.conversion, null, 'no conversion for a processing job')
  console.log('PASS: getConversionByJob (queued/processing) returns status only, no conversion')

  // 5. getConversionByJob (failed) — error information, no conversion.
  // pendingJob is still 'processing' for upload-1, so this createJob call
  // hits the Phase 18 duplicate-job guard and returns pendingJob itself
  // rather than creating a distinct job — confirmed below, then reused.
  const failedJob = await jobService.createJob({ userId: 'user-1', uploadId: 'upload-1' })
  assertEqual(failedJob.id, pendingJob.id, 'a second createJob call for the same in-flight upload returns the existing active job')
  await jobService.markFailed(failedJob.id, 'simulated vectorization failure')
  const failedResult = await service.getConversionByJob(failedJob.id)
  assertEqual(failedResult.jobStatus, 'failed', 'getConversionByJob status for a failed job')
  assertEqual(failedResult.conversion, null, 'no conversion for a failed job')
  assertEqual(failedResult.errorMessage, 'simulated vectorization failure', 'getConversionByJob surfaces the error message')
  console.log('PASS: getConversionByJob (failed) returns error information, no conversion')

  await assertRejects(() => service.getConversionByJob('does-not-exist'), /No job found/, 'missing job')
  console.log('PASS: getConversionByJob rejects an unknown job id (404 case)')

  // 6. listUserConversions
  const userConversions = await service.listUserConversions('user-1')
  assertEqual(userConversions.length, 1, 'listUserConversions returns only this user’s completed conversions')
  assertTrue(Boolean(userConversions[0]?.downloadUrl), 'listUserConversions attaches download URLs')
  assertEqual(await service.listUserConversions('user-2').then((c) => c.length), 0, 'no conversions for a different user')
  console.log('PASS: listUserConversions lists a user’s conversions with download URLs')

  // 7. Expired download URL is detected by verifySignedUrl (no download-serving route exists yet to test through)
  const expiredUrl = await storage.getSignedDownloadUrl(conversion?.storageKey ?? '', -10)
  const expiredVerification = await storage.verifySignedUrl(expiredUrl)
  assertEqual(expiredVerification.expired, true, 'a URL signed with a negative TTL is already expired')
  assertEqual(expiredVerification.valid, false, 'an expired URL is not valid even with a correct signature')
  console.log('PASS: verifySignedUrl detects an expired download URL')

  // 8. Unknown job rejected by processJob
  await assertRejects(() => service.processJob('does-not-exist'), /No job found/, 'unknown job')
  console.log('PASS: processJob rejects an unknown job id')

  // 8b. Idempotent queue redelivery (Phase 18): re-processing an
  // already-completed job returns the existing conversion as a no-op — no
  // re-vectorization, no second debit.
  const redeliveredConversions = await service.processJob(job.id)
  assertEqual(redeliveredConversions.length, 1, 'redelivery returns the existing conversion')
  assertEqual(redeliveredConversions[0]?.id, conversion?.id, 'redelivery returns the same conversion, not a new one')
  const balanceAfterRedelivery = await creditsService.getBalance('user-1')
  assertEqual(balanceAfterRedelivery.balance, 9, 'redelivering a completed job does not debit credits again')
  assertEqual(
    (await creditsRepo.findTransactionsByUserId('user-1')).filter((t) => t.type === 'debit').length,
    1,
    'still only one debit transaction after redelivery',
  )
  console.log('PASS: processJob is idempotent for an already-completed job — no re-processing, no double debit')

  // 8c. Retry safety (Phase 18): a job already 'processing' must not be
  // processed a second time concurrently — processJob throws ConflictError
  // instead of racing the in-flight attempt.
  const racingJob = await jobService.createJob({ userId: 'user-1', uploadId: 'upload-1' })
  await jobService.markProcessing(racingJob.id)
  await assertRejects(() => service.processJob(racingJob.id), /already being processed/, 'processing collision')
  assertEqual(
    await service.listUserConversions('user-1').then((c) => c.length),
    1,
    'no extra conversion created for the job that was already processing',
  )
  console.log('PASS: processJob refuses to process a job that is already processing (safe retry behavior)')

  // Resolve racingJob so upload-1 has no active job left before test 9 —
  // otherwise the Phase 18 duplicate-job guard would hand back racingJob
  // (still 'processing') instead of letting a new job be created.
  await jobService.markFailed(racingJob.id, 'simulated: superseded by retry-safety test')

  // 9. Job whose upload no longer exists is rejected — run last, since it
  // deletes upload-1 out from under any later test that would need it.
  const orphanJob = await jobService.createJob({ userId: 'user-1', uploadId: 'upload-1' })
  const uploadsRepoAny = uploadsRepo as unknown as { uploadsById: Map<string, Upload> }
  uploadsRepoAny.uploadsById.delete('upload-1')
  await assertRejects(() => service.processJob(orphanJob.id), /No upload found/, 'missing upload')
  console.log('PASS: processJob rejects a job whose upload no longer exists')

  console.log('\nAll ConversionService smoke tests passed.')
}

run().catch((error: unknown) => {
  console.error('Smoke test failed:', error)
  throw error
})
