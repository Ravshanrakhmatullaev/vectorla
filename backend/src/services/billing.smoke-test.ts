// Billing of conversions: Professional Trace costs 2 credits, but 1 when it
// falls back to the ImageTracer engine; the charge happens once per job,
// after tracing and before the result is stored; concurrent jobs racing for
// the last credits never overdraw and the loser stores nothing; concurrent
// failure handlers refund once.
//
// Run with: npx tsx src/services/billing.smoke-test.ts (from inside backend/)
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
import { InsufficientCreditsError } from '../errors'
import { loadDecoderWasmModules, createTestPng } from '../testSupport/wasmTestFixtures'
import { listPageOf } from '../testSupport/r2Fake'
import type { R2Client } from '../integrations/r2'

function assertTrue(condition: boolean, message: string): void {
  if (!condition) throw new Error(message)
}

async function run(): Promise<void> {
  const wasm = await loadDecoderWasmModules()
  const png = await createTestPng()
  const objects = new Map<string, ArrayBuffer>()
  const r2: R2Client = {
    async put(key, data) {
      objects.set(key, data instanceof ArrayBuffer ? data : await new Response(data).arrayBuffer())
    },
    async get(key) {
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
  const failingEngine = (() => {
    throw new Error('engine bug (simulated)')
  }) as typeof runDecodedTracePipeline
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
    const original = console.error
    console.error = () => {}
    try {
      return await fn()
    } finally {
      console.error = original
    }
  }

  // 1. Professional Trace on the engine: 2 credits. Quick: 1.
  await credits.credit('u1', 10, 'grant')
  await service().processJob((await newJob('u1', 'professional')).id)
  assertTrue((await balance('u1')) === 8, `Professional on the engine costs 2 (balance ${await balance('u1')})`)
  await service().processJob((await newJob('u1')).id)
  assertTrue((await balance('u1')) === 7, 'Quick costs 1')
  console.log('PASS: Professional Trace costs 2 credits, Quick Trace 1')

  // 2. Professional falls back to ImageTracer: 1 credit, and the result is delivered.
  const fallbackJob = await newJob('u1', 'professional')
  const [fallbackResult] = await quietly(() => service(failingEngine).processJob(fallbackJob.id))
  assertTrue(Boolean(fallbackResult) && objects.has(fallbackResult!.storageKey), 'the fallback result is stored')
  assertTrue((await balance('u1')) === 6, `Professional fallback costs 1 (balance ${await balance('u1')})`)
  const txs = await credits.getRecentTransactions('u1', 1)
  assertTrue(txs[0]!.reason.includes('fell back'), 'the ledger entry says it fell back')
  console.log('PASS: Professional Trace that falls back to the basic engine is billed 1 credit')

  // 3. A retried (redelivered) job is never charged twice.
  const retried = await newJob('u1', 'professional')
  await service().processJob(retried.id)
  await service().processJob(retried.id) // stale redelivery of a completed job
  assertTrue((await balance('u1')) === 4, 'a redelivered completed job is not charged again')
  console.log('PASS: redelivery never charges twice')

  // 4. Concurrent Professional jobs racing for the last 2 credits: exactly
  // one is charged and stores a result; the other fails with nothing
  // charged or stored, and is refunded nothing (it was never charged).
  await credits.credit('u2', 2, 'grant')
  const [a, b] = [await newJob('u2', 'professional'), await newJob('u2', 'professional')]
  const outcomes = await Promise.allSettled([service().processJob(a.id), service().processJob(b.id)])
  const won = outcomes.filter((o) => o.status === 'fulfilled')
  const lost = outcomes.filter((o): o is PromiseRejectedResult => o.status === 'rejected')
  assertTrue(won.length === 1 && lost.length === 1, `one job wins (${won.length} fulfilled)`)
  assertTrue(lost[0]!.reason instanceof InsufficientCreditsError, 'the other fails with insufficient credits')
  assertTrue((await balance('u2')) === 0, 'the balance never goes negative')
  const loserId = outcomes[0]!.status === 'rejected' ? a.id : b.id
  await service().failJob(loserId, 'insufficient credits')
  assertTrue((await balance('u2')) === 0, 'the losing job was never charged, so nothing is refunded')
  assertTrue(![...objects.keys()].some((key) => key.includes(loserId)), 'the losing job stored no result')
  console.log('PASS: concurrent jobs for the last credits: one charged and stored, the other neither')

  // 5. Concurrent failure handlers (consumer, sweeper, dead-letter queue) refund once.
  await credits.credit('u3', 5, 'grant')
  const charged = await newJob('u3', 'professional')
  await jobService.claimForProcessing(charged)
  await credits.chargeJob('u3', charged.id, 2, 'charged before a crash')
  await Promise.allSettled(Array.from({ length: 5 }, () => service().failJob(charged.id, 'crashed')))
  assertTrue((await balance('u3')) === 5, `refunded exactly once (balance ${await balance('u3')})`)
  console.log('PASS: five concurrent failJob calls refund exactly once')

  console.log('\nAll billing smoke tests passed.')
}

run().catch((error: unknown) => {
  console.error('Smoke test failed:', error)
  process.exit(1)
})
