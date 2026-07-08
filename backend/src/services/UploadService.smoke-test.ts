// Local smoke test for UploadService — exercises the real service against
// in-memory fakes for R2 and the uploads repository, so it runs with plain
// Node and needs no real Cloudflare/Supabase credentials.
//
// Run with: npx tsx src/services/UploadService.smoke-test.ts (from inside backend/)
import { UploadService } from './UploadService'
import { StorageService } from './StorageService'
import { InMemoryUploadsRepository } from '../repositories/InMemoryUploadsRepository'
import type { R2Client } from '../integrations/r2'

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
    if (!pattern.test(msg)) {
      throw new Error(`${message}: error message "${msg}" did not match ${pattern}`)
    }
    return
  }
  throw new Error(`${message}: expected the call to reject, but it resolved`)
}

// Phase 17 added magic-byte signature validation (see validateUpload.ts) —
// fixtures declaring image/png must start with the real PNG signature.
function pngBytes(size = 16): ArrayBuffer {
  const buffer = new ArrayBuffer(Math.max(size, 8))
  new Uint8Array(buffer).set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  return buffer
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
    async list(prefix) {
      return Array.from(objects.keys()).filter((key) => key.startsWith(prefix))
    },
  }
}

async function run() {
  const r2 = createFakeR2Client()
  const storage = new StorageService(r2, 'test-secret')
  const repository = new InMemoryUploadsRepository()
  const service = new UploadService(storage, repository)

  const validPng = pngBytes()

  // 1. Successful upload
  const upload = await service.createUpload({
    userId: 'user-1',
    plan: 'free',
    file: validPng,
    originalFileName: 'logo.png',
    mimeType: 'image/png',
  })
  assertEqual(upload.status, 'stored', 'upload.status')
  assertEqual(upload.originalFileName, 'logo.png', 'upload.originalFileName')
  assertTrue(Boolean(upload.id), 'upload.id should be set')
  assertTrue(r2.objects.has(upload.storageKey), 'file should be stored in R2')
  console.log('PASS: valid upload succeeds and is stored in R2')

  // 1b. Security (Phase 17): storage key is fully random, no user-controlled
  // path segments — it must not contain the original filename at all.
  assertTrue(!upload.storageKey.includes('logo'), 'storage key must not embed the original filename')
  assertTrue(/^uploads\/user-1\/[0-9a-f-]+\.png$/.test(upload.storageKey), 'storage key is <prefix>/<userId>/<uuid>.<ext>')
  console.log('PASS: storage key contains no user-controlled filename, only random id + canonical extension')

  // 1c. Security (Phase 17): uploaded SVGs are rejected outright, even with
  // a matching extension — only backend-generated SVGs are ever allowed.
  await assertRejects(
    () =>
      service.createUpload({
        userId: 'user-1',
        plan: 'free',
        file: new TextEncoder().encode('<svg onload="alert(1)"></svg>').buffer as ArrayBuffer,
        originalFileName: 'logo.svg',
        mimeType: 'image/svg+xml',
      }),
    /Unsupported file type/,
    'svg upload rejected outright',
  )
  console.log('PASS: uploaded SVG files are rejected outright')

  // 1d. Security (Phase 17): declared MIME type must match the file's actual
  // magic bytes, not just its label — a mislabeled file is rejected.
  await assertRejects(
    () =>
      service.createUpload({
        userId: 'user-1',
        plan: 'free',
        file: new TextEncoder().encode('#!/bin/sh\necho pwned').buffer as ArrayBuffer,
        originalFileName: 'shell.png',
        mimeType: 'image/png',
      }),
    /File content does not match declared type/,
    'content signature mismatch rejected',
  )
  console.log('PASS: a file whose content does not match its declared image type is rejected')

  // 2. Duplicate filename rejected
  await assertRejects(
    () =>
      service.createUpload({
        userId: 'user-1',
        plan: 'free',
        file: validPng,
        originalFileName: 'logo.png',
        mimeType: 'image/png',
      }),
    /already been uploaded/,
    'duplicate filename',
  )
  console.log('PASS: duplicate filename rejected')

  // 2b. Race condition (Phase 18): the service's pre-check alone has a
  // TOCTOU window, so the real guarantee is repository.create() enforcing
  // (userId, originalFileName) uniqueness atomically. Simulate two
  // concurrent uploads with the same filename that both got past the
  // pre-check (as they could under real concurrency) by calling
  // repository.create() directly, twice, for the same (user, filename) —
  // exactly one must succeed.
  const racingRepo = new InMemoryUploadsRepository()
  const raceUpload = (id: string) => ({
    id,
    userId: 'race-user',
    originalFileName: 'race.png',
    mimeType: 'image/png',
    sizeBytes: 10,
    storageKey: `uploads/race-user/${id}.png`,
    status: 'stored' as const,
    createdAt: new Date().toISOString(),
  })
  const raceOutcomes = await Promise.allSettled([
    racingRepo.create(raceUpload('race-1')),
    racingRepo.create(raceUpload('race-2')),
  ])
  const raceFulfilled = raceOutcomes.filter((outcome) => outcome.status === 'fulfilled')
  const raceRejected = raceOutcomes.filter((outcome) => outcome.status === 'rejected')
  assertEqual(raceFulfilled.length, 1, 'exactly one concurrent duplicate-filename upload succeeds')
  assertEqual(raceRejected.length, 1, 'exactly one concurrent duplicate-filename upload is rejected as a conflict')
  const [firstRaceRejection] = raceRejected
  const raceRejectionMessage =
    firstRaceRejection?.status === 'rejected' && firstRaceRejection.reason instanceof Error
      ? firstRaceRejection.reason.message
      : ''
  assertTrue(/already been uploaded/.test(raceRejectionMessage), 'the losing concurrent upload is rejected as a conflict')
  console.log('PASS: repository.create() closes the duplicate-upload race atomically, even without the service pre-check')

  // 3. Invalid mime type rejected
  await assertRejects(
    () =>
      service.createUpload({
        userId: 'user-1',
        plan: 'free',
        file: validPng,
        originalFileName: 'doc.pdf',
        mimeType: 'application/pdf',
      }),
    /Unsupported file type/,
    'invalid mime type',
  )
  console.log('PASS: invalid mime type rejected')

  // 4. Mismatched extension rejected
  await assertRejects(
    () =>
      service.createUpload({
        userId: 'user-1',
        plan: 'free',
        file: validPng,
        originalFileName: 'logo.jpg',
        mimeType: 'image/png',
      }),
    /does not match declared type/,
    'mismatched extension',
  )
  console.log('PASS: mismatched extension rejected')

  // 5. Empty file rejected
  await assertRejects(
    () =>
      service.createUpload({
        userId: 'user-1',
        plan: 'free',
        file: new ArrayBuffer(0),
        originalFileName: 'empty.png',
        mimeType: 'image/png',
      }),
    /empty/,
    'empty file',
  )
  console.log('PASS: empty file rejected')

  // 6. Oversized file rejected (free plan max is 5MB)
  const oversized = pngBytes(6 * 1024 * 1024)
  await assertRejects(
    () =>
      service.createUpload({
        userId: 'user-2',
        plan: 'free',
        file: oversized,
        originalFileName: 'huge.png',
        mimeType: 'image/png',
      }),
    /exceeds/,
    'oversized file',
  )
  console.log('PASS: oversized file rejected for free plan')

  // 7. Larger plan allows the same size free rejects
  const uploadBig = await service.createUpload({
    userId: 'user-3',
    plan: 'pro',
    file: oversized,
    originalFileName: 'huge.png',
    mimeType: 'image/png',
  })
  assertEqual(uploadBig.status, 'stored', 'uploadBig.status')
  console.log('PASS: pro plan allows a larger file size than free')

  // 8. Missing file name rejected
  await assertRejects(
    () =>
      service.createUpload({
        userId: 'user-4',
        plan: 'free',
        file: validPng,
        originalFileName: '',
        mimeType: 'image/png',
      }),
    /Missing file name/,
    'missing file name',
  )
  console.log('PASS: missing file name rejected')

  console.log('\nAll UploadService smoke tests passed.')
}

run().catch((error: unknown) => {
  console.error('Smoke test failed:', error)
  throw error
})
