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
      return value instanceof ReadableStream ? value : null
    },
    async delete(key) {
      objects.delete(key)
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
  const queueService = new QueueService(createFakeQueueClient())
  const jobService = new JobService(jobsRepo, uploadsRepo, queueService)
  const r2 = createFakeR2Client()
  const storage = new StorageService(r2, 'test-secret')
  const service = new ConversionService(jobService, uploadsRepo, storage, conversionsRepo)

  await seedUpload(uploadsRepo)

  // 1. Happy path: full pipeline runs end-to-end
  const job = await jobService.createJob({ userId: 'user-1', uploadId: 'upload-1' })
  const conversions = await service.processJob(job.id)

  assertEqual(conversions.length, 1, 'processJob returns one conversion')
  const conversion = conversions[0]
  assertTrue(Boolean(conversion), 'conversion should be defined')
  assertEqual(conversion?.jobId, job.id, 'conversion references the job')
  assertEqual(conversion?.userId, 'user-1', 'conversion references the user')
  assertEqual(conversion?.format, 'svg', 'conversion format is svg')
  assertTrue((conversion?.fileSizeBytes ?? 0) > 0, 'conversion has a non-zero file size')
  assertTrue(r2.objects.has(conversion?.storageKey ?? ''), 'placeholder SVG stored in R2')
  console.log('PASS: processJob stores a placeholder SVG and saves conversion metadata')

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

  // 5. getConversionByJob (failed) — error information, no conversion
  const failedJob = await jobService.createJob({ userId: 'user-1', uploadId: 'upload-1' })
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
