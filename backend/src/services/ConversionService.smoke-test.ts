// Local smoke test for ConversionService — exercises the full placeholder
// pipeline (load job/upload, mark processing, store SVG in R2, save
// conversion metadata, mark completed) against in-memory fakes.
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
  const storage = new StorageService(r2)
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

  // 2. getConversion returns the saved row
  const fetched = await service.getConversion(conversion?.id ?? '')
  assertEqual(fetched.id, conversion?.id, 'getConversion returns the right conversion')
  console.log('PASS: getConversion returns the created conversion')

  await assertRejects(() => service.getConversion('missing-conversion'), /No conversion found/, 'missing conversion')
  console.log('PASS: getConversion rejects an unknown conversion id')

  // 3. Unknown job rejected
  await assertRejects(() => service.processJob('does-not-exist'), /No job found/, 'unknown job')
  console.log('PASS: processJob rejects an unknown job id')

  // 4. Job whose upload no longer exists is rejected (and left out of "completed")
  const orphanJob = await jobService.createJob({ userId: 'user-1', uploadId: 'upload-1' })
  // Simulate the upload having disappeared without touching JobService's API.
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
