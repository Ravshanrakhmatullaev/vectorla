// Resilience of the conversion pipeline: memory exhaustion fails a job at
// once (no retry loop, no fallback, nothing charged, a public message);
// many conversions running concurrently each complete and are charged once;
// two deliveries of the same job at once produce one result and one charge;
// a temporary storage failure is retried and then succeeds.
//
// Run with: npx tsx src/services/resilience.smoke-test.ts (from inside backend/)
import { StorageService } from './StorageService'
import { JobService } from './JobService'
import { QueueService } from './QueueService'
import { CreditsService } from './CreditsService'
import { ConversionService } from './ConversionService'
import { createImageAnalysisService } from './ImageAnalysisService'
import { InMemoryUploadsRepository } from '../repositories/InMemoryUploadsRepository'
import { InMemoryJobsRepository } from '../repositories/InMemoryJobsRepository'
import { InMemoryConversionsRepository } from '../repositories/InMemoryConversionsRepository'
import { InMemoryCreditsRepository } from '../repositories/InMemoryCreditsRepository'
import { runDecodedTracePipeline } from '../pipeline/ProfessionalTracePipeline'
import { handleConversionMessages, type ConversionMessage } from '../queueConsumer'
import { PUBLIC_JOB_ERRORS } from '../api/publicErrors'
import { MAX_JOB_ATTEMPTS } from '../config'
import { loadDecoderWasmModules, createTestPng } from '../testSupport/wasmTestFixtures'
import { listPageOf } from '../testSupport/r2Fake'
import type { R2Client } from '../integrations/r2'

function assertTrue(condition: boolean, message: string): void {
  if (!condition) throw new Error(message)
}

function message(jobId: string, attempts = 1): ConversionMessage & { acked: boolean; retried: boolean } {
  return {
    body: { jobId },
    attempts,
    acked: false,
    retried: false,
    ack() {
      this.acked = true
    },
    retry() {
      this.retried = true
    },
  }
}

async function run(): Promise<void> {
  const wasm = await loadDecoderWasmModules()
  const png = await createTestPng()
  const objects = new Map<string, ArrayBuffer>()
  let failGets = 0
  const r2: R2Client = {
    async put(key, data) {
      objects.set(key, data instanceof ArrayBuffer ? data : await new Response(data).arrayBuffer())
    },
    async get(key) {
      if (key.startsWith('uploads/') && failGets > 0) {
        failGets--
        throw new Error('R2 temporarily unavailable (simulated)')
      }
      const data = objects.get(key)
      return data ? new Response(data.slice(0)).body : null
    },
    async delete(key) {
      objects.delete(key)
    },
    async list(prefix) {
      return [...objects.keys()].filter((key) => key.startsWith(prefix))
    },
    async listPage(prefix) {
      return listPageOf(objects.keys(), prefix)
    },
  }
  const storage = new StorageService(r2, 'secret')
  const uploads = new InMemoryUploadsRepository()
  const jobs = new InMemoryJobsRepository()
  const conversions = new InMemoryConversionsRepository()
  const credits = new CreditsService(new InMemoryCreditsRepository(), false)
  const jobService = new JobService(jobs, uploads, new QueueService({ async send() {} }), credits, conversions, storage)
  const service = (pipeline = runDecodedTracePipeline) =>
    new ConversionService(jobService, uploads, storage, conversions, createImageAnalysisService(wasm), wasm, credits, pipeline)
  let n = 0
  const newJob = async (userId: string, preset?: string) => {
    const id = `up-${++n}`
    const storageKey = `uploads/${userId}/${id}.png`
    await r2.put(storageKey, png.slice(0))
    await uploads.create({ id, userId, originalFileName: `${id}.png`, mimeType: 'image/png', sizeBytes: png.byteLength, storageKey, status: 'stored', createdAt: new Date().toISOString() })
    return jobService.createJob({ userId, uploadId: id, preset })
  }
  const balance = async (userId: string) => (await credits.getBalance(userId)).balance
  const quietly = async <T>(fn: () => Promise<T>) => {
    const [error, warn] = [console.error, console.warn]
    console.error = console.warn = () => {}
    try {
      return await fn()
    } finally {
      console.error = error
      console.warn = warn
    }
  }

  // 1. Memory exhaustion in the engine: failed on the first attempt (no
  // retry, no ImageTracer fallback), nothing charged, a public message.
  await credits.credit('mem', 5, 'grant')
  const oomJob = await newJob('mem', 'professional')
  const outOfMemory = (() => {
    throw new RangeError('Array buffer allocation failed')
  }) as typeof runDecodedTracePipeline
  const oomMessage = message(oomJob.id, 1)
  await quietly(() => handleConversionMessages([oomMessage], service(outOfMemory), jobService))
  const oomAfter = await jobService.getJob(oomJob.id)
  assertTrue(oomAfter.status === 'failed' && oomMessage.acked && !oomMessage.retried, 'out of memory fails the job at once, without retrying')
  assertTrue(oomAfter.errorMessage === PUBLIC_JOB_ERRORS.tooComplex, `public message (${oomAfter.errorMessage})`)
  assertTrue((await balance('mem')) === 5, 'nothing is charged')
  assertTrue(![...objects.keys()].some((key) => key.includes(oomJob.id)), 'no fallback result is stored')
  console.log('PASS: memory exhaustion fails the job immediately (no retry, no fallback, not charged, public message)')

  // 2. Many conversions at once, for several users: each completes and is charged once.
  const users = ['c1', 'c2', 'c3']
  for (const user of users) await credits.credit(user, 20, 'grant')
  const batch = await Promise.all(users.flatMap((user) => Array.from({ length: 4 }, (_, i) => newJob(user, i % 2 ? 'professional' : undefined))))
  const results = await Promise.all(batch.map((job) => service().processJob(job.id)))
  assertTrue(results.every((r) => r.length === 1), 'all 12 concurrent conversions complete')
  for (const user of users) assertTrue((await balance(user)) === 20 - 2 * 1 - 2 * 2, `${user} charged exactly 2×1 + 2×2 credits (balance ${await balance(user)})`)
  console.log('PASS: 12 concurrent conversions for 3 users all complete, each charged exactly once')

  // 3. Two deliveries of the same job at the same time: one result, one charge.
  await credits.credit('dup', 5, 'grant')
  const dup = await newJob('dup')
  const both = await Promise.allSettled([service().processJob(dup.id), service().processJob(dup.id)])
  assertTrue(both.filter((r) => r.status === 'fulfilled').length >= 1, 'one delivery completes the job')
  assertTrue((await jobService.getJob(dup.id)).status === 'completed', 'the job is completed')
  assertTrue((await balance('dup')) === 4, `charged once (balance ${await balance('dup')})`)
  assertTrue((await conversions.findByUserId('dup')).length === 1, 'one conversion row')
  console.log('PASS: two simultaneous deliveries of one job produce one result and one charge')

  // 4. A temporary storage failure is retried (job back to queued with
  // backoff), then the next delivery completes it; charged once.
  await credits.credit('retry', 5, 'grant')
  const flaky = await newJob('retry')
  failGets = 1
  const first = message(flaky.id, 1)
  await quietly(() => handleConversionMessages([first], service(), jobService))
  assertTrue(first.retried && !first.acked && (await jobService.getJob(flaky.id)).status === 'queued', 'a storage failure is retried')
  const second = message(flaky.id, 2)
  await handleConversionMessages([second], service(), jobService)
  assertTrue(second.acked && (await jobService.getJob(flaky.id)).status === 'completed', 'the retry completes the job')
  assertTrue((await balance('retry')) === 4, 'charged once across the retry')
  // Storage down for every attempt: failed on the last attempt and not charged.
  const down = await newJob('retry')
  failGets = MAX_JOB_ATTEMPTS
  for (let attempt = 1; attempt <= MAX_JOB_ATTEMPTS; attempt++) await quietly(() => handleConversionMessages([message(down.id, attempt)], service(), jobService))
  assertTrue((await jobService.getJob(down.id)).status === 'failed', 'a persistent storage failure fails the job on the last attempt')
  assertTrue((await balance('retry')) === 4, 'and nothing is charged for it')
  console.log('PASS: temporary storage failures are retried; persistent ones fail on the last attempt, uncharged')

  console.log('\nAll resilience smoke tests passed.')
}

run().catch((error: unknown) => {
  console.error('Smoke test failed:', error)
  process.exit(1)
})
