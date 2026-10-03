// Local smoke test for job lifecycle safety: processing leases and
// takeover, transient vs permanent failures, exactly-once charging and
// refunds, the dead-letter handler, the stale-job sweeper, and concurrency.
//
// Run with: npx tsx src/queueConsumer.smoke-test.ts (from inside backend/)
import type { R2Bucket, Queue } from '@cloudflare/workers-types'
import type { Env } from './env'
import type { ConversionQueueMessage } from './integrations/queue'
import { JobService } from './services/JobService'
import { ConversionService } from './services/ConversionService'
import { CreditsService } from './services/CreditsService'
import { QueueService } from './services/QueueService'
import { StorageService } from './services/StorageService'
import { createImageAnalysisService } from './services/ImageAnalysisService'
import { createQueueClient } from './integrations/queue'
import { createR2Client } from './integrations/r2'
import { createCreditsRepository } from './repositories/createCreditsRepository'
import { createConversionsRepository } from './repositories/createConversionsRepository'
import { createUploadsRepository } from './repositories/createUploadsRepository'
import { createJobsRepository } from './repositories/createJobsRepository'
import { handleConversionMessages, handleDeadLetters, sweepStaleJobs, type ConversionMessage } from './queueConsumer'
import { loadDecoderWasmModules, createTestPng } from './testSupport/wasmTestFixtures'
import { JOB_LEASE_MS, MAX_JOB_ATTEMPTS, STALE_PROCESSING_JOB_MS } from './config'

function assertEqual<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) throw new Error(`${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
}
function assertTrue(condition: boolean, message: string): void {
  if (!condition) throw new Error(message)
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
      if (!value) return null
      const body = new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array(value))
          controller.close()
        },
      })
      return { body } as never
    },
    async delete(key: string) {
      store.delete(key)
    },
  } as unknown as R2Bucket
  const { png, jpeg, webp } = await loadDecoderWasmModules()
  return {
    UPLOADS_BUCKET: bucket,
    CONVERSION_QUEUE: { async send() {}, async sendBatch() {} } as unknown as Queue<ConversionQueueMessage>,
    SUPABASE_URL: '',
    SUPABASE_SERVICE_ROLE_KEY: '',
    DOWNLOAD_URL_SECRET: 'test-secret',
    VECTORIZATION_PROVIDER: 'vectorla',
    PNG_DECODER_WASM: png,
    JPEG_DECODER_WASM: jpeg,
    WEBP_DECODER_WASM: webp,
    // In-memory repositories (no Supabase URL). The dev-only automatic
    // credit top-up is disabled below by constructing CreditsService directly.
    ENVIRONMENT: 'development',
  }
}

function fakeMessage(jobId: string, attempts = 1): ConversionMessage & { acked: boolean; retryDelay: number | null } {
  const state = { acked: false, retryDelay: null as number | null }
  return {
    body: { jobId },
    attempts,
    ack() {
      state.acked = true
    },
    retry(options) {
      state.retryDelay = options?.delaySeconds ?? 0
    },
    get acked() {
      return state.acked
    },
    get retryDelay() {
      return state.retryDelay
    },
  }
}

async function run(): Promise<void> {
  const env = await createFakeEnv()
  // Real services over the in-memory repositories, with real credit
  // enforcement (no development auto top-up).
  const uploads = createUploadsRepository(env)
  const jobsRepo = createJobsRepository(env)
  const credits = new CreditsService(createCreditsRepository(env), false)
  const storage = new StorageService(createR2Client(env.UPLOADS_BUCKET), env.DOWNLOAD_URL_SECRET)
  const conversionsRepo = createConversionsRepository(env)
  const jobService = new JobService(jobsRepo, uploads, new QueueService(createQueueClient(env.CONVERSION_QUEUE)), credits, conversionsRepo, storage)
  const decoderWasm = { png: env.PNG_DECODER_WASM, jpeg: env.JPEG_DECODER_WASM, webp: env.WEBP_DECODER_WASM }
  const conversions = new ConversionService(
    jobService,
    uploads,
    storage,
    conversionsRepo,
    createImageAnalysisService(decoderWasm),
    decoderWasm,
    credits,
  )

  let uploadCounter = 0
  async function seedUpload(userId: string, withSource = true): Promise<string> {
    const id = `upload-${++uploadCounter}`
    const storageKey = `uploads/${userId}/${id}/logo.png`
    if (withSource) await env.UPLOADS_BUCKET.put(storageKey, await createTestPng())
    await uploads.create({
      id,
      userId,
      originalFileName: `${id}.png`,
      mimeType: 'image/png',
      sizeBytes: 10,
      storageKey,
      status: 'stored',
      createdAt: new Date().toISOString(),
    })
    return id
  }
  const balanceOf = async (userId: string) => (await credits.getBalance(userId)).balance

  // 1. Expired lease: a job left 'processing' by a crashed worker is taken over and completed.
  await credits.credit('u1', 5, 'grant')
  const crashed = await jobService.createJob({ userId: 'u1', uploadId: await seedUpload('u1') })
  const claimedLongAgo = await jobService.claimForProcessing(crashed, Date.now() - JOB_LEASE_MS - 60_000)
  // The crashed worker had already charged it before dying.
  await credits.chargeJob('u1', claimedLongAgo.id, 1, 'first attempt')
  const takeoverMessage = fakeMessage(crashed.id, 2)
  await handleConversionMessages([takeoverMessage], conversions, jobService)
  assertEqual((await jobService.getJob(crashed.id)).status, 'completed', 'expired lease is taken over and completed')
  assertTrue(takeoverMessage.acked, 'takeover delivery is acked')
  assertEqual(await balanceOf('u1'), 4, 'a job retried after a crash is charged exactly once')
  console.log('PASS: expired processing lease is taken over; the job completes and is charged exactly once')

  // 2. Live lease: another delivery is working on it -> retry after the lease, don't touch the job.
  const live = await jobService.createJob({ userId: 'u1', uploadId: await seedUpload('u1') })
  await jobService.claimForProcessing(live)
  const liveMessage = fakeMessage(live.id)
  await handleConversionMessages([liveMessage], conversions, jobService)
  assertTrue(!liveMessage.acked, 'live-lease delivery is not acked')
  assertTrue((liveMessage.retryDelay ?? 0) >= JOB_LEASE_MS / 1000 - 5, `live-lease delivery retries after the lease (${liveMessage.retryDelay}s)`)
  assertEqual((await jobService.getJob(live.id)).status, 'processing', 'live-lease job is left to its owner')
  console.log(`PASS: live processing lease -> retry in ${liveMessage.retryDelay}s, job untouched`)
  await conversions.failJob(live.id, 'cleanup')

  // 3. Transient error: back to 'queued' + backoff; on the last attempt -> failed + refunded.
  const flaky = await jobService.createJob({ userId: 'u1', uploadId: await seedUpload('u1') })
  let calls = 0
  const flakyConversions = {
    async processJob(jobId: string) {
      calls++
      await jobService.claimForProcessing(await jobService.getJob(jobId))
      await credits.chargeJob('u1', jobId, 1, 'flaky')
      throw new Error('R2 timeout (simulated)')
    },
    failJob: (jobId: string, reason: string) => conversions.failJob(jobId, reason),
  } as unknown as ConversionService
  const balanceBeforeFlaky = await balanceOf('u1')
  const firstTry = fakeMessage(flaky.id, 1)
  await handleConversionMessages([firstTry], flakyConversions, jobService)
  const afterFirst = await jobService.getJob(flaky.id)
  assertEqual(afterFirst.status, 'queued', 'transient failure returns the job to queued (not failed)')
  assertEqual(firstTry.retryDelay, 15, 'first retry backs off 15 s')
  assertTrue(!firstTry.acked, 'transient failure is not acked')
  const lastTry = fakeMessage(flaky.id, MAX_JOB_ATTEMPTS)
  await handleConversionMessages([lastTry], flakyConversions, jobService)
  assertEqual((await jobService.getJob(flaky.id)).status, 'failed', 'last attempt fails the job terminally')
  assertTrue(lastTry.acked, 'terminal failure is acked')
  assertEqual(calls, 2, 'processJob attempted twice')
  assertEqual(await balanceOf('u1'), balanceBeforeFlaky, 'terminally failed job is refunded (charged once, refunded once)')
  console.log('PASS: transient error -> queued + 15s backoff; final attempt -> failed and fully refunded')

  // 4. Refunds are exactly-once even if failJob runs repeatedly (DLQ + sweeper overlap).
  await conversions.failJob(flaky.id, 'again')
  await handleDeadLetters([fakeMessage(flaky.id)], conversions)
  assertEqual(await balanceOf('u1'), balanceBeforeFlaky, 'repeated failJob never refunds twice')
  console.log('PASS: failJob / dead-letter handling are idempotent — one refund per job')

  // 5. Insufficient credits: permanent -> failed immediately, nothing charged, acked.
  const broke = await jobService.createJob({ userId: 'u-broke', uploadId: await seedUpload('u-broke') })
  const brokeMessage = fakeMessage(broke.id)
  await handleConversionMessages([brokeMessage], conversions, jobService)
  assertEqual((await jobService.getJob(broke.id)).status, 'failed', 'no credits -> job failed')
  assertTrue(brokeMessage.acked && brokeMessage.retryDelay === null, 'no credits -> acked, never retried')
  assertEqual(await balanceOf('u-broke'), 0, 'balance never goes negative')
  console.log('PASS: insufficient credits fail the job permanently without charging or retrying')

  // 6. Dead-lettered job still 'processing' -> failed and refunded.
  const dead = await jobService.createJob({ userId: 'u1', uploadId: await seedUpload('u1') })
  await jobService.claimForProcessing(dead)
  await credits.chargeJob('u1', dead.id, 1, 'charged before crashing')
  const beforeDead = await balanceOf('u1')
  await handleDeadLetters([fakeMessage(dead.id)], conversions)
  assertEqual((await jobService.getJob(dead.id)).status, 'failed', 'dead-lettered job is failed')
  assertEqual(await balanceOf('u1'), beforeDead + 1, 'dead-lettered job is refunded')
  console.log('PASS: dead-letter queue fails and refunds jobs whose messages exhausted every retry')

  // 7. Sweeper: stale 'processing' jobs are failed + refunded; fresh ones are untouched.
  const stale = await jobService.createJob({ userId: 'u1', uploadId: await seedUpload('u1') })
  await jobService.claimForProcessing(stale, Date.now() - STALE_PROCESSING_JOB_MS - 60_000)
  await credits.chargeJob('u1', stale.id, 1, 'charged then lost')
  const fresh = await jobService.createJob({ userId: 'u1', uploadId: await seedUpload('u1') })
  await jobService.claimForProcessing(fresh)
  const beforeSweep = await balanceOf('u1')
  const swept = await sweepStaleJobs(conversions, jobService)
  assertEqual(swept, 1, 'exactly one stale job swept')
  assertEqual((await jobService.getJob(stale.id)).status, 'failed', 'stale job failed by the sweeper')
  assertEqual((await jobService.getJob(fresh.id)).status, 'processing', 'fresh job untouched by the sweeper')
  assertEqual(await balanceOf('u1'), beforeSweep + 1, 'swept job refunded')
  console.log('PASS: scheduled sweeper fails + refunds stuck jobs and leaves live ones alone')
  await conversions.failJob(fresh.id, 'cleanup')

  // 8. Concurrent job creation for one upload yields exactly one active job.
  const raceUpload = await seedUpload('u1')
  const created = await Promise.all(Array.from({ length: 8 }, () => jobService.createJob({ userId: 'u1', uploadId: raceUpload })))
  assertEqual(new Set(created.map((j) => j.id)).size, 1, 'concurrent createJob calls share one active job')
  assertEqual(
    (await jobsRepo.findPageByUserId('u1', 100, 0)).jobs.filter((j) => j.uploadId === raceUpload).length,
    1,
    'only one job row exists for the raced upload',
  )
  console.log('PASS: 8 concurrent createJob calls produce exactly one active job')

  // 9. Concurrent charges for different jobs never overdraw a balance.
  await credits.credit('u-race', 3, 'grant')
  const results = await Promise.allSettled(Array.from({ length: 10 }, (_, i) => credits.chargeJob('u-race', `race-job-${i}`, 1, 'race')))
  assertEqual(results.filter((r) => r.status === 'fulfilled').length, 3, 'exactly 3 of 10 concurrent charges succeed on a balance of 3')
  assertEqual(await balanceOf('u-race'), 0, 'balance ends at exactly zero, never negative')
  console.log('PASS: 10 concurrent charges on a balance of 3 -> exactly 3 succeed, balance 0')

  // 10. Superseding refund is exactly-once under concurrency.
  await credits.credit('u-sup', 2, 'grant')
  const supUpload = await seedUpload('u-sup')
  const done = await jobService.createJob({ userId: 'u-sup', uploadId: supUpload })
  await handleConversionMessages([fakeMessage(done.id)], conversions, jobService)
  assertEqual(await balanceOf('u-sup'), 1, 'quick job charged 1')
  await Promise.all(
    Array.from({ length: 6 }, () => jobService.createJob({ userId: 'u-sup', uploadId: supUpload, preset: 'professional', supersedesJobId: done.id })),
  )
  assertEqual(await balanceOf('u-sup'), 2, 'superseded job refunded exactly once despite 6 concurrent requests')
  assertEqual(await conversionsRepo.findByJobId(done.id), null, 'the superseded (refunded) result is no longer downloadable')
  console.log('PASS: 6 concurrent superseding requests refund the prior job exactly once and remove its result')

  // 11. A refund that errors once is not lost: the message is retried, and
  // the redelivery of the (now failed) job re-applies the refund.
  await credits.credit('u-rf', 1, 'grant')
  const rf = await jobService.createJob({ userId: 'u-rf', uploadId: await seedUpload('u-rf') })
  let refundFailures = 1
  const flakyCredits = Object.create(credits) as CreditsService
  flakyCredits.refundJobDebit = async (...args: Parameters<CreditsService['refundJobDebit']>) => {
    if (refundFailures-- > 0) throw new Error('Supabase RPC timeout (simulated)')
    return credits.refundJobDebit(...args)
  }
  const rfConversions = new ConversionService(jobService, uploads, storage, conversionsRepo, createImageAnalysisService(decoderWasm), decoderWasm, flakyCredits)
  const failingProcess = Object.create(rfConversions) as ConversionService
  failingProcess.processJob = async (jobId: string) => {
    await jobService.claimForProcessing(await jobService.getJob(jobId))
    await credits.chargeJob('u-rf', jobId, 1, 'charged')
    throw new Error('engine crashed (simulated)')
  }
  const rfLast = fakeMessage(rf.id, MAX_JOB_ATTEMPTS)
  await handleConversionMessages([rfLast], failingProcess, jobService)
  assertEqual((await jobService.getJob(rf.id)).status, 'failed', 'job marked failed even though its refund errored')
  assertEqual(await balanceOf('u-rf'), 0, 'refund not yet applied')
  assertTrue(!rfLast.acked && rfLast.retryDelay !== null, 'a terminal failure whose refund errored is retried, not acked')
  const rfRedelivery = fakeMessage(rf.id, MAX_JOB_ATTEMPTS + 1)
  await handleConversionMessages([rfRedelivery], rfConversions, jobService)
  assertTrue(rfRedelivery.acked, 'redelivery of the failed job is acked')
  assertEqual(await balanceOf('u-rf'), 1, 'redelivery applies the refund that failed')
  await handleConversionMessages([fakeMessage(rf.id, MAX_JOB_ATTEMPTS + 2)], rfConversions, jobService)
  assertEqual(await balanceOf('u-rf'), 1, 'further redeliveries never refund twice')
  console.log('PASS: a refund that errors is retried via redelivery and applied exactly once')

  console.log('\nAll job lifecycle / queue consumer smoke tests passed.')
}

run().catch((error: unknown) => {
  console.error('Smoke test failed:', error)
  throw error
})
