// Local smoke test for OrphanCleanupService.detectOrphans — verifies both
// orphan shapes (R2 object with no DB row, DB row with no R2 object) against
// in-memory fakes. This service is detection-only and not wired to any
// cron/queue trigger — see the service's own doc comment.
//
// Run with: npx tsx src/services/OrphanCleanupService.smoke-test.ts (from inside backend/)
import { OrphanCleanupService } from './OrphanCleanupService'
import { InMemoryUploadsRepository } from '../repositories/InMemoryUploadsRepository'
import { InMemoryConversionsRepository } from '../repositories/InMemoryConversionsRepository'
import type { R2Client } from '../integrations/r2'
import type { Upload, Conversion } from '../types'

function assertEqual<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
  }
}

function assertTrue(condition: boolean, message: string): void {
  if (!condition) throw new Error(message)
}

function createFakeR2Client(): R2Client & { objects: Map<string, ArrayBuffer> } {
  const objects = new Map<string, ArrayBuffer>()
  return {
    objects,
    async put(key, data) {
      objects.set(key, data as ArrayBuffer)
    },
    async get(key) {
      return objects.has(key) ? new ReadableStream() : null
    },
    async delete(key) {
      objects.delete(key)
    },
    async list(prefix) {
      return Array.from(objects.keys()).filter((key) => key.startsWith(prefix))
    },
  }
}

async function run() {
  const r2 = createFakeR2Client()
  const uploadsRepo = new InMemoryUploadsRepository()
  const conversionsRepo = new InMemoryConversionsRepository()
  const service = new OrphanCleanupService(r2, uploadsRepo, conversionsRepo)

  // 1. Nothing orphaned yet
  const emptyReport = await service.detectOrphans()
  assertEqual(emptyReport.orphanedR2Keys.length, 0, 'no orphaned R2 keys initially')
  assertEqual(emptyReport.uploadsMissingR2Object.length, 0, 'no uploads missing R2 objects initially')
  assertEqual(emptyReport.conversionsMissingR2Object.length, 0, 'no conversions missing R2 objects initially')
  console.log('PASS: detectOrphans reports nothing when R2 and the database agree')

  // 2. A healthy, matched upload + conversion — must not be flagged
  const healthyUpload: Upload = {
    id: 'upload-1',
    userId: 'user-1',
    originalFileName: 'logo.png',
    mimeType: 'image/png',
    sizeBytes: 10,
    storageKey: 'uploads/user-1/upload-1.png',
    status: 'stored',
    createdAt: new Date().toISOString(),
  }
  await uploadsRepo.create(healthyUpload)
  await r2.put(healthyUpload.storageKey, new ArrayBuffer(10))

  const healthyConversion: Conversion = {
    id: 'conversion-1',
    jobId: 'job-1',
    userId: 'user-1',
    format: 'svg',
    storageKey: 'conversions/user-1/job-1/output.svg',
    fileSizeBytes: 20,
    downloadUrl: null,
    createdAt: new Date().toISOString(),
  }
  await conversionsRepo.create(healthyConversion)
  await r2.put(healthyConversion.storageKey, new ArrayBuffer(20))

  const healthyReport = await service.detectOrphans()
  assertEqual(healthyReport.orphanedR2Keys.length, 0, 'matched upload+conversion are not flagged as orphaned R2 keys')
  assertEqual(healthyReport.uploadsMissingR2Object.length, 0, 'matched upload is not flagged as missing its R2 object')
  assertEqual(
    healthyReport.conversionsMissingR2Object.length,
    0,
    'matched conversion is not flagged as missing its R2 object',
  )
  console.log('PASS: detectOrphans does not flag correctly matched uploads/conversions')

  // 3. An R2 object with no database row (e.g. a Supabase insert that failed
  // right after a successful R2 write — see UploadService's documented
  // "no rollback" limitation)
  await r2.put('uploads/user-1/orphan-object.png', new ArrayBuffer(5))

  const orphanedObjectReport = await service.detectOrphans()
  assertTrue(
    orphanedObjectReport.orphanedR2Keys.includes('uploads/user-1/orphan-object.png'),
    'an R2 object with no matching DB row is detected as orphaned',
  )
  assertEqual(orphanedObjectReport.orphanedR2Keys.length, 1, 'exactly the one orphaned key is reported')
  console.log('PASS: detectOrphans finds an R2 object with no matching database row')

  // 4. A database row whose R2 object doesn't exist (deleted out-of-band, or
  // the write never actually landed)
  await r2.delete(healthyUpload.storageKey)

  const missingObjectReport = await service.detectOrphans()
  assertEqual(missingObjectReport.uploadsMissingR2Object.length, 1, 'exactly one upload is missing its R2 object')
  assertEqual(
    missingObjectReport.uploadsMissingR2Object[0]?.id,
    healthyUpload.id,
    'the upload missing its R2 object is identified correctly',
  )
  console.log('PASS: detectOrphans finds a database row whose R2 object no longer exists')

  console.log('\nAll OrphanCleanupService smoke tests passed.')
}

run().catch((error: unknown) => {
  console.error('Smoke test failed:', error)
  throw error
})
