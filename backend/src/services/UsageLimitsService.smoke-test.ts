// Smoke test for abuse limits (services/UsageLimitsService.ts): uploads per
// 10 minutes and per day, the storage quota, the concurrent-conversion
// limit (also through JobService and POST /jobs), the 429 response with
// Retry-After, and the optional per-IP Cloudflare Rate Limiting binding.
//
// Run with: npx tsx src/services/UsageLimitsService.smoke-test.ts (from inside backend/)
import { UsageLimitsService } from './UsageLimitsService'
import { JobService } from './JobService'
import { QueueService } from './QueueService'
import { InMemoryUploadsRepository } from '../repositories/InMemoryUploadsRepository'
import { InMemoryJobsRepository } from '../repositories/InMemoryJobsRepository'
import { PLAN_LIMITS } from '../config'
import { QuotaExceededError, RateLimitedError } from '../errors'
import { mapErrorToResponse } from '../api/response'
import worker from '../index'
import { loadDecoderWasmModules } from '../testSupport/wasmTestFixtures'
import type { Env, RateLimitBinding } from '../env'
import type { Job, Upload } from '../types'
import type { QueueClient, ConversionQueueMessage } from '../integrations/queue'
import type { R2Bucket, Queue } from '@cloudflare/workers-types'

function assertTrue(condition: boolean, message: string): void {
  if (!condition) throw new Error(message)
}

async function rejects(fn: () => Promise<unknown>, type: new (...args: never[]) => Error, message: string): Promise<Error> {
  try {
    await fn()
  } catch (error) {
    assertTrue(error instanceof type, `${message}: expected ${type.name}, got ${String(error)}`)
    return error as Error
  }
  throw new Error(`${message}: expected ${type.name}, nothing was thrown`)
}

const MINUTE = 60_000
let seq = 0
function upload(userId: string, createdAt: number, sizeBytes = 1000): Upload {
  const id = `u-${++seq}`
  return { id, userId, originalFileName: `${id}.png`, mimeType: 'image/png', sizeBytes, storageKey: `uploads/${userId}/${id}.png`, status: 'stored', createdAt: new Date(createdAt).toISOString() }
}
function job(userId: string, uploadId: string, status: Job['status']): Job {
  const now = new Date().toISOString()
  return { id: `j-${++seq}`, userId, uploadId, status, preset: null, settings: null, errorMessage: null, retryCount: 0, version: 0, createdAt: now, updatedAt: now, completedAt: null }
}

async function run(): Promise<void> {
  const now = Date.now()
  const free = PLAN_LIMITS.free

  // 1. Uploads per 10 minutes: the limit is reached, older uploads don't count.
  {
    const uploads = new InMemoryUploadsRepository()
    const limits = new UsageLimitsService(uploads, new InMemoryJobsRepository())
    for (let i = 0; i < free.uploadsPerTenMinutes - 1; i++) await uploads.create(upload('a', now - 2 * MINUTE))
    await uploads.create(upload('a', now - 30 * MINUTE)) // outside the window
    await limits.assertCanStartUpload('a', 'free', now)
    await uploads.create(upload('a', now - MINUTE))
    const error = (await rejects(() => limits.assertCanStartUpload('a', 'free', now), RateLimitedError, '10-minute limit')) as RateLimitedError
    assertTrue(error.retryAfterSeconds === 600, 'Retry-After is the 10-minute window')
    await limits.assertCanStartUpload('other-user', 'free', now)
    await limits.assertCanStartUpload('a', 'starter', now) // a paid plan has more headroom
    const response = mapErrorToResponse(error, 'req')
    assertTrue(response.status === 429 && response.headers.get('Retry-After') === '600', '429 with Retry-After')
    assertTrue(((await response.json()) as { error: { code: string } }).error.code === 'RATE_LIMITED', 'error code RATE_LIMITED')
    console.log(`PASS: ${free.uploadsPerTenMinutes} uploads per 10 minutes (free), per user, 429 + Retry-After`)
  }

  // 2. Uploads per day.
  {
    const uploads = new InMemoryUploadsRepository()
    const limits = new UsageLimitsService(uploads, new InMemoryJobsRepository())
    for (let i = 0; i < free.uploadsPerDay; i++) await uploads.create(upload('b', now - 60 * MINUTE - i * MINUTE))
    await rejects(() => limits.assertCanStartUpload('b', 'free', now), RateLimitedError, 'daily limit')
    await limits.assertCanStartUpload('b', 'free', now + 24 * 60 * MINUTE) // a day later the window has moved
    console.log(`PASS: ${free.uploadsPerDay} uploads per rolling day (free)`)
  }

  // 3. Storage quota counts stored originals plus the incoming file.
  {
    const uploads = new InMemoryUploadsRepository()
    const limits = new UsageLimitsService(uploads, new InMemoryJobsRepository())
    await uploads.create(upload('c', now - 5 * 24 * 60 * MINUTE, free.storageQuotaBytes - 2_000_000))
    await limits.assertStorageAvailable('c', 'free', 1_000_000)
    const error = await rejects(() => limits.assertStorageAvailable('c', 'free', 3_000_000), QuotaExceededError, 'quota')
    assertTrue(mapErrorToResponse(error, 'req').status === 429, 'quota maps to 429')
    console.log(`PASS: storage quota ${Math.round(free.storageQuotaBytes / 1048576)} MB (free) blocks the upload that would exceed it`)
  }

  // 4. Concurrent conversions: queued + processing count, finished ones don't;
  // JobService enforces it for new jobs but still returns an upload's active job.
  {
    const uploads = new InMemoryUploadsRepository()
    const jobs = new InMemoryJobsRepository()
    const limits = new UsageLimitsService(uploads, jobs)
    const queue: QueueClient = { async send(_message: ConversionQueueMessage) {} }
    const service = new JobService(jobs, uploads, new QueueService(queue), undefined, undefined, undefined, limits)
    const made: Upload[] = []
    for (let i = 0; i < free.maxActiveJobs + 2; i++) made.push(await uploads.create(upload('d', now - i * MINUTE)))
    await jobs.create(job('d', made[0]!.id, 'completed'))
    for (let i = 0; i < free.maxActiveJobs; i++) await service.createJob({ userId: 'd', uploadId: made[i + 1]!.id, plan: 'free' })
    const error = (await rejects(() => service.createJob({ userId: 'd', uploadId: made[free.maxActiveJobs + 1]!.id, plan: 'free' }), RateLimitedError, 'concurrency')) as RateLimitedError
    assertTrue(error.retryAfterSeconds === 30, 'concurrency Retry-After 30 s')
    const existing = await service.createJob({ userId: 'd', uploadId: made[1]!.id, plan: 'free' })
    assertTrue(existing.status === 'queued', "re-requesting an upload's active job is not blocked")
    await rejects(() => limits.assertCanStartUpload('d', 'free', now), RateLimitedError, 'uploads blocked while at the conversion limit')
    console.log(`PASS: ${free.maxActiveJobs} concurrent conversions (free); an upload's own active job is still returned`)
  }

  // 5. Normal use stays far below every limit: 12 uploads an hour for a
  // working day, two conversions at a time.
  {
    const uploads = new InMemoryUploadsRepository()
    const limits = new UsageLimitsService(uploads, new InMemoryJobsRepository())
    for (let minute = 0; minute < 8 * 60; minute += 5) {
      const at = now + minute * MINUTE
      await limits.assertCanStartUpload('normal', 'free', at)
      await limits.assertStorageAvailable('normal', 'free', 200_000)
      await uploads.create(upload('normal', at, 200_000))
    }
    console.log('PASS: a normal working day (an upload every 5 minutes for 8 hours) is never limited on the free plan')
  }

  // 6. Optional Cloudflare Rate Limiting binding: per client IP, before routing;
  // a limiter failure never blocks requests; absent binding = no IP limit.
  {
    const { png, jpeg, webp } = await loadDecoderWasmModules()
    const baseEnv: Env = {
      UPLOADS_BUCKET: {} as R2Bucket,
      CONVERSION_QUEUE: {} as Queue<ConversionQueueMessage>,
      SUPABASE_URL: '',
      SUPABASE_SERVICE_ROLE_KEY: '',
      DOWNLOAD_URL_SECRET: 'test-secret',
      VECTORIZATION_PROVIDER: 'placeholder',
      PNG_DECODER_WASM: png,
      JPEG_DECODER_WASM: jpeg,
      WEBP_DECODER_WASM: webp,
      ENVIRONMENT: 'development',
    }
    const seen: string[] = []
    const denyAfterTwo: RateLimitBinding = {
      async limit({ key }) {
        seen.push(key)
        return { success: seen.filter((k) => k === key).length <= 2 }
      },
    }
    const env = { ...baseEnv, API_RATE_LIMITER: denyAfterTwo }
    const call = (ip: string, path = '/api/v1/openapi.json') => worker.fetch(new Request(`http://localhost${path}`, { headers: { 'CF-Connecting-IP': ip } }), env)
    assertTrue((await call('203.0.113.7')).status === 200 && (await call('203.0.113.7')).status === 200, 'first two requests pass')
    const limited = await call('203.0.113.7')
    assertTrue(limited.status === 429 && limited.headers.get('Retry-After') === '60', 'third request from the same IP gets 429')
    assertTrue((await call('198.51.100.9')).status === 200, 'another IP is unaffected')
    const before = seen.length
    assertTrue((await call('203.0.113.7', '/api/v1/health')).status === 200 && seen.length === before, 'health checks are never limited')
    const broken: RateLimitBinding = {
      async limit() {
        throw new Error('binding unavailable')
      },
    }
    const original = console.error
    console.error = () => {}
    const failOpen = await worker.fetch(new Request('http://localhost/api/v1/openapi.json', { headers: { 'CF-Connecting-IP': '203.0.113.7' } }), { ...baseEnv, API_RATE_LIMITER: broken })
    console.error = original
    assertTrue(failOpen.status === 200, 'a failing limiter lets the request through')
    assertTrue((await worker.fetch(new Request('http://localhost/api/v1/health', { headers: { 'CF-Connecting-IP': '203.0.113.7' } }), baseEnv)).status === 200, 'no binding: no IP limit')
    console.log('PASS: optional per-IP Rate Limiting binding: 429 per IP, health exempt, fails open, absent = off')
  }

  console.log('\nAll usage limit smoke tests passed.')
}

run().catch((error: unknown) => {
  console.error('Smoke test failed:', error)
  process.exit(1)
})
