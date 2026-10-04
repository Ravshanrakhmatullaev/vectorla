// Storage failures and orphan cleanup: a stored original whose upload row
// fails is deleted at once; a result whose conversion row fails is deleted
// and retried; a failed job's partial result is removed; the scheduled
// OrphanSweeper deletes old objects with no row, shard by shard, and never
// recent ones or ones with a row.
//
// Run with: npx tsx src/services/storageCleanup.smoke-test.ts (from inside backend/)
import { UploadService } from './UploadService'
import { StorageService } from './StorageService'
import { JobService } from './JobService'
import { QueueService } from './QueueService'
import { CreditsService } from './CreditsService'
import { ConversionService } from './ConversionService'
import { createImageAnalysisService } from './ImageAnalysisService'
import { OrphanSweeper, ORPHAN_GRACE_MS, ORPHAN_SHARD_COUNT, orphanShardPrefix, orphanShardFor } from './OrphanCleanupService'
import { InMemoryUploadsRepository } from '../repositories/InMemoryUploadsRepository'
import { InMemoryJobsRepository } from '../repositories/InMemoryJobsRepository'
import { InMemoryConversionsRepository } from '../repositories/InMemoryConversionsRepository'
import { InMemoryCreditsRepository } from '../repositories/InMemoryCreditsRepository'
import { loadDecoderWasmModules, createTestPng } from '../testSupport/wasmTestFixtures'
import type { R2Client, R2ListPage } from '../integrations/r2'
import type { Conversion, Upload } from '../types'

function assertTrue(condition: boolean, message: string): void {
  if (!condition) throw new Error(message)
}

/** In-memory R2 with upload times, paging, and injectable failures. */
function fakeR2(pageSize = 1000) {
  const objects = new Map<string, { data: ArrayBuffer | ReadableStream; uploaded: Date }>()
  const failDelete = new Set<string>()
  const client: R2Client = {
    async put(key, data) {
      objects.set(key, { data, uploaded: new Date() })
    },
    async get(key) {
      const object = objects.get(key)
      if (!object) return null
      return object.data instanceof ArrayBuffer ? new Response(object.data).body : object.data
    },
    async delete(key) {
      if (failDelete.has(key)) throw new Error(`simulated R2 delete failure for ${key}`)
      objects.delete(key)
    },
    async list(prefix) {
      return [...objects.keys()].filter((key) => key.startsWith(prefix))
    },
    async listPage(prefix, cursor, limit = pageSize): Promise<R2ListPage> {
      // Like R2, the cursor resumes after the last key returned, so deleting
      // listed objects doesn't shift later pages.
      const keys = [...objects.keys()].filter((key) => key.startsWith(prefix) && (!cursor || key > cursor)).sort()
      const page = keys.slice(0, limit)
      return {
        objects: page.map((key) => ({ key, uploaded: objects.get(key)!.uploaded })),
        cursor: keys.length > limit ? page[page.length - 1] : undefined,
      }
    },
  }
  return { client, objects, failDelete }
}

function quiet<T>(fn: () => Promise<T>): Promise<T> {
  const original = console.error
  console.error = () => {}
  return fn().finally(() => {
    console.error = original
  })
}

async function run(): Promise<void> {
  const USER = '0f6e2c1a-0000-4000-8000-000000000001'

  // 1. Upload row insert fails after the original was stored: the original is deleted.
  {
    const r2 = fakeR2()
    const uploads = new InMemoryUploadsRepository()
    uploads.create = async () => {
      throw new Error('Supabase insert failed (simulated)')
    }
    const service = new UploadService(new StorageService(r2.client, 'secret'), uploads)
    let failed = false
    const png = await createTestPng()
    await quiet(() => service.createUpload({ userId: USER, plan: 'free', file: png, originalFileName: 'a.png', mimeType: 'image/png' }).catch(() => (failed = true)))
    assertTrue(failed, 'the upload request fails')
    assertTrue(r2.objects.size === 0, 'its stored original is deleted at once')
    // If that delete fails too, the request still reports the original error and the sweep is the backstop.
    const r2b = fakeR2()
    const original = r2b.client.put
    r2b.client.put = async (key, data) => {
      r2b.failDelete.add(key)
      return original(key, data)
    }
    let message = ''
    await quiet(() =>
      new UploadService(new StorageService(r2b.client, 'secret'), uploads)
        .createUpload({ userId: USER, plan: 'free', file: png.slice(0), originalFileName: 'b.png', mimeType: 'image/png' })
        .catch((error: Error) => (message = error.message)),
    )
    assertTrue(message.includes('insert failed'), 'the row error, not the cleanup error, is reported')
    assertTrue(r2b.objects.size === 1, 'a failed cleanup leaves the object for the orphan sweep')
    console.log('PASS: a stored original whose upload row fails is deleted at once (sweep is the backstop)')
  }

  // 2. Conversion row insert fails: the result file is deleted, the retry
  // stores it again and completes; a job that then fails for good leaves nothing.
  {
    const wasm = await loadDecoderWasmModules()
    const r2 = fakeR2()
    const storage = new StorageService(r2.client, 'secret')
    const uploads = new InMemoryUploadsRepository()
    const jobs = new InMemoryJobsRepository()
    const conversions = new InMemoryConversionsRepository()
    const credits = new CreditsService(new InMemoryCreditsRepository(), false)
    const jobService = new JobService(jobs, uploads, new QueueService({ async send() {} }), credits, conversions, storage)
    const service = new ConversionService(jobService, uploads, storage, conversions, createImageAnalysisService(wasm), wasm, credits)
    await credits.credit(USER, 5, 'grant')
    const upload: Upload = { id: 'up-1', userId: USER, originalFileName: 'x.png', mimeType: 'image/png', sizeBytes: 10, storageKey: `uploads/${USER}/up-1.png`, status: 'stored', createdAt: new Date().toISOString() }
    await r2.client.put(upload.storageKey, await createTestPng())
    await uploads.create(upload)
    const job = await jobService.createJob({ userId: USER, uploadId: upload.id })
    const realCreate = conversions.create.bind(conversions)
    let failures = 1
    conversions.create = async (conversion: Conversion) => {
      if (failures-- > 0) throw new Error('conversion insert failed (simulated)')
      return realCreate(conversion)
    }
    let threw = false
    await service.processJob(job.id).catch(() => (threw = true))
    assertTrue(threw, 'first attempt fails at the row insert')
    assertTrue(![...r2.objects.keys()].some((key) => key.startsWith('conversions/')), 'its result file was deleted')
    await jobService.releaseAfterError(job.id, 'retry')
    const [conversion] = await service.processJob(job.id)
    assertTrue(Boolean(conversion) && r2.objects.has(conversion!.storageKey), 'the retry stores the result again and completes')
    console.log('PASS: a result whose conversion row fails is deleted, and the retry stores it again')

    // A failed job's leftover result (file + row) is removed by failJob.
    const job2Upload = { ...upload, id: 'up-2', originalFileName: 'y.png', storageKey: `uploads/${USER}/up-2.png` }
    await r2.client.put(job2Upload.storageKey, await createTestPng())
    await uploads.create(job2Upload)
    const job2 = await jobService.createJob({ userId: USER, uploadId: job2Upload.id })
    const leftoverKey = `conversions/${USER}/${job2.id}/output.svg`
    await r2.client.put(leftoverKey, new ArrayBuffer(4))
    await realCreate({ id: 'c-left', jobId: job2.id, userId: USER, format: 'svg', storageKey: leftoverKey, fileSizeBytes: 4, downloadUrl: null, createdAt: new Date().toISOString() })
    await service.failJob(job2.id, 'simulated terminal failure')
    assertTrue(!r2.objects.has(leftoverKey) && (await conversions.findByJobId(job2.id)) === null, "a failed job's partial result is deleted")
    console.log("PASS: failJob deletes a failed job's partial result (file and row)")
  }

  // 3. OrphanSweeper: 32 shards cover every UUID-keyed object exactly once;
  // old objects without a row are deleted, recent ones and ones with a row
  // are kept; pages are followed.
  {
    const prefixes = Array.from({ length: ORPHAN_SHARD_COUNT }, (_, shard) => orphanShardPrefix(shard))
    assertTrue(new Set(prefixes).size === ORPHAN_SHARD_COUNT, 'shard prefixes are distinct')
    for (const key of [`uploads/${USER}/z.png`, `conversions/${USER}/j/output.svg`, 'uploads/ffffffff-0000-4000-8000-000000000000/q.png']) {
      assertTrue(prefixes.filter((p) => key.startsWith(p)).length === 1, `${key} is in exactly one shard`)
    }
    const slots = new Set(Array.from({ length: ORPHAN_SHARD_COUNT }, (_, i) => orphanShardFor(i * 15 * 60 * 1000)))
    assertTrue(slots.size === ORPHAN_SHARD_COUNT, 'consecutive 15-minute cron runs visit every shard')

    const r2 = fakeR2(3) // tiny pages to exercise the cursor
    const uploads = new InMemoryUploadsRepository()
    const conversions = new InMemoryConversionsRepository()
    const now = Date.now()
    const old = new Date(now - ORPHAN_GRACE_MS - 60_000)
    const add = (key: string, uploaded: Date) => r2.objects.set(key, { data: new ArrayBuffer(1), uploaded })
    for (let i = 0; i < 7; i++) add(`uploads/${USER}/orphan-${i}.png`, old)
    add(`uploads/${USER}/recent.png`, new Date(now - 60_000))
    add(`uploads/${USER}/kept.png`, old)
    await uploads.create({ id: 'k', userId: USER, originalFileName: 'kept.png', mimeType: 'image/png', sizeBytes: 1, storageKey: `uploads/${USER}/kept.png`, status: 'stored', createdAt: old.toISOString() })
    add('uploads/1aaaaaaa-0000-4000-8000-000000000000/other-shard.png', old)
    const sweeper = new OrphanSweeper(r2.client, uploads, conversions)
    const shard = prefixes.indexOf(`uploads/${USER[0]}`)
    const result = await sweeper.sweep(shard, now)
    assertTrue(result.deleted === 7, `7 orphans deleted (got ${result.deleted})`)
    assertTrue(r2.objects.has(`uploads/${USER}/recent.png`), 'a recent object (upload in flight) is kept')
    assertTrue(r2.objects.has(`uploads/${USER}/kept.png`), 'an object with a row is kept')
    assertTrue(r2.objects.has('uploads/1aaaaaaa-0000-4000-8000-000000000000/other-shard.png'), 'other shards are untouched')
    console.log('PASS: OrphanSweeper deletes old row-less objects in its shard only (paged), keeps recent and referenced ones')
  }

  console.log('\nAll storage cleanup smoke tests passed.')
}

run().catch((error: unknown) => {
  console.error('Smoke test failed:', error)
  process.exit(1)
})
