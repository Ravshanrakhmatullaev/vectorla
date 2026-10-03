// Local smoke test for RetentionService.purgeExpired — expired uploads and
// their results are deleted (files first, then the row), recent uploads and
// uploads with an in-flight job are kept, and a storage failure leaves the
// row for the next run. In-memory repositories and a fake R2 client.
//
// Run with: npx tsx src/services/RetentionService.smoke-test.ts (from inside backend/)
import { RetentionService } from './RetentionService'
import { StorageService } from './StorageService'
import { InMemoryUploadsRepository } from '../repositories/InMemoryUploadsRepository'
import { InMemoryJobsRepository } from '../repositories/InMemoryJobsRepository'
import { InMemoryConversionsRepository } from '../repositories/InMemoryConversionsRepository'
import { UPLOAD_RETENTION_DAYS } from '../config'
import type { R2Client } from '../integrations/r2'
import type { Conversion, Job, JobStatus, Upload } from '../types'

function assertEqual<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
  }
}

const DAY_MS = 24 * 60 * 60 * 1000
const NOW = Date.parse('2026-10-03T12:00:00Z')
const daysAgo = (days: number) => new Date(NOW - days * DAY_MS).toISOString()

function createFakeR2(): R2Client & { objects: Set<string>; failDeleteFor: Set<string> } {
  const objects = new Set<string>()
  const failDeleteFor = new Set<string>()
  return {
    objects,
    failDeleteFor,
    async put(key) {
      objects.add(key)
    },
    async get(key) {
      return objects.has(key) ? new ReadableStream() : null
    },
    async delete(key) {
      if (failDeleteFor.has(key)) throw new Error(`simulated R2 failure for ${key}`)
      objects.delete(key)
    },
    async list(prefix) {
      return [...objects].filter((key) => key.startsWith(prefix))
    },
  }
}

async function run() {
  const r2 = createFakeR2()
  const uploads = new InMemoryUploadsRepository()
  const jobs = new InMemoryJobsRepository()
  const conversions = new InMemoryConversionsRepository()
  const service = new RetentionService(uploads, jobs, conversions, new StorageService(r2, 'test-secret'))

  async function seed(id: string, ageDays: number, jobStatus: JobStatus | null): Promise<void> {
    const upload: Upload = {
      id,
      userId: 'user-1',
      originalFileName: `${id}.png`,
      mimeType: 'image/png',
      sizeBytes: 10,
      storageKey: `uploads/user-1/${id}.png`,
      status: 'stored',
      createdAt: daysAgo(ageDays),
    }
    await uploads.create(upload)
    r2.objects.add(upload.storageKey)
    if (!jobStatus) return
    const job: Job = {
      id: `job-${id}`,
      userId: 'user-1',
      uploadId: id,
      status: jobStatus,
      preset: null,
      settings: null,
      errorMessage: null,
      retryCount: 0,
      version: 1,
      createdAt: upload.createdAt,
      updatedAt: upload.createdAt,
      completedAt: jobStatus === 'completed' ? upload.createdAt : null,
    }
    await jobs.create(job)
    if (jobStatus === 'completed') {
      const conversion: Conversion = {
        id: `conv-${id}`,
        jobId: job.id,
        userId: 'user-1',
        format: 'svg',
        storageKey: `conversions/user-1/${id}.svg`,
        fileSizeBytes: 10,
        downloadUrl: null,
        createdAt: upload.createdAt,
      }
      await conversions.create(conversion)
      r2.objects.add(conversion.storageKey)
    }
  }

  await seed('old-done', UPLOAD_RETENTION_DAYS + 1, 'completed')
  await seed('old-failed', UPLOAD_RETENTION_DAYS + 5, 'failed')
  await seed('old-no-job', UPLOAD_RETENTION_DAYS + 2, null)
  await seed('old-busy', UPLOAD_RETENTION_DAYS + 3, 'processing')
  await seed('recent', UPLOAD_RETENTION_DAYS - 1, 'completed')

  // 1. Expired, finished uploads are purged with their files; others stay.
  const first = await service.purgeExpired(NOW)
  assertEqual(first.purged, 3, 'three expired uploads purged')
  assertEqual(first.skipped, 1, 'the upload with a processing job is skipped')
  for (const id of ['old-done', 'old-failed', 'old-no-job']) {
    assertEqual(await uploads.findById(id), null, `${id} row deleted`)
    assertEqual(r2.objects.has(`uploads/user-1/${id}.png`), false, `${id} original deleted from storage`)
  }
  assertEqual(r2.objects.has('conversions/user-1/old-done.svg'), false, 'expired result deleted from storage')
  assertEqual((await uploads.findById('old-busy'))?.id, 'old-busy', 'upload with an in-flight job kept')
  assertEqual(r2.objects.has('uploads/user-1/old-busy.png'), true, 'in-flight upload file kept')
  assertEqual((await uploads.findById('recent'))?.id, 'recent', 'recent upload kept')
  assertEqual(r2.objects.has('conversions/user-1/recent.svg'), true, 'recent result kept')
  console.log('PASS: expired uploads and their results are purged; recent and in-flight uploads are kept')

  // 2. Exactly at the boundary (30 days minus a second) is still kept.
  await seed('boundary', UPLOAD_RETENTION_DAYS - 1 / 86_400, 'completed')
  assertEqual((await service.purgeExpired(NOW)).purged, 0, 'nothing newer than the retention period is purged')
  console.log(`PASS: uploads younger than ${UPLOAD_RETENTION_DAYS} days are never purged`)

  // 3. Once the job finishes, the next run purges the previously busy upload.
  const busy = await jobs.findById('job-old-busy')
  await jobs.update(busy!, { ...busy!, status: 'failed', version: busy!.version + 1 })
  assertEqual((await service.purgeExpired(NOW)).purged, 1, 'previously busy upload purged after its job ended')
  console.log('PASS: an upload skipped for an in-flight job is purged on a later run')

  // 4. A storage failure keeps the row (no orphaned files); the retry succeeds.
  await seed('flaky', UPLOAD_RETENTION_DAYS + 1, 'completed')
  r2.failDeleteFor.add('conversions/user-1/flaky.svg')
  const failed = await service.purgeExpired(NOW)
  assertEqual(failed.purged, 0, 'nothing purged when a file deletion fails')
  assertEqual(failed.skipped, 1, 'the failed upload is reported as skipped')
  assertEqual((await uploads.findById('flaky'))?.id, 'flaky', 'row kept so the next run can retry')
  r2.failDeleteFor.clear()
  assertEqual((await service.purgeExpired(NOW)).purged, 1, 'retry purges it')
  assertEqual(r2.objects.has('conversions/user-1/flaky.svg') || r2.objects.has('uploads/user-1/flaky.png'), false, 'no files left after retry')
  console.log('PASS: a storage failure leaves the row for a retry instead of orphaning files')

  // 5. The batch limit bounds one run.
  for (let i = 0; i < 4; i++) await seed(`batch-${i}`, UPLOAD_RETENTION_DAYS + 10, 'completed')
  assertEqual((await service.purgeExpired(NOW, 3)).purged, 3, 'one run purges at most `limit` uploads')
  assertEqual((await service.purgeExpired(NOW, 3)).purged, 1, 'the rest go on the next run')
  console.log('PASS: purging is batched per run')
}

run().catch((error) => {
  console.error('FAIL:', error)
  process.exit(1)
})
