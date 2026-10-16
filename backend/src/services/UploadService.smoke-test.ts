// Local smoke test for UploadService — exercises the real service against
// in-memory fakes for R2 and the uploads repository, so it runs with plain
// Node and needs no real Cloudflare/Supabase credentials.
//
// Run with: npx tsx src/services/UploadService.smoke-test.ts (from inside backend/)
import { listPageOf } from '../testSupport/r2Fake'
import { UploadService } from './UploadService'
import { StorageService } from './StorageService'
import { InMemoryUploadsRepository } from '../repositories/InMemoryUploadsRepository'
import { ConflictError } from '../errors'
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
    async listPage(prefix) {
      return listPageOf(objects.keys(), prefix)
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

  // 2. Regression (staging bug, 2026-10-16): re-uploading a file name used to
  // fail with 409 "already been uploaded", which the web app showed as the
  // generic "Upload failed. The file could not be uploaded." (and Retry could
  // never succeed). A repeated name is now stored as "name (2).ext", "name (3).ext" …
  const again = await service.createUpload({ userId: 'user-1', plan: 'free', file: validPng, originalFileName: 'logo.png', mimeType: 'image/png' })
  assertEqual(again.originalFileName, 'logo (2).png', 'the same file name uploaded again is stored as a numbered copy')
  assertTrue(again.id !== upload.id && again.storageKey !== upload.storageKey, 'the repeat is a separate upload with its own storage key')
  assertTrue(r2.objects.has(upload.storageKey) && r2.objects.has(again.storageKey), 'both files are stored in R2')
  const third = await service.createUpload({ userId: 'user-1', plan: 'free', file: validPng, originalFileName: 'logo.png', mimeType: 'image/png' })
  assertEqual(third.originalFileName, 'logo (3).png', 'a third upload of the same name is "(3)"')
  const otherUser = await service.createUpload({ userId: 'user-9', plan: 'free', file: validPng, originalFileName: 'logo.png', mimeType: 'image/png' })
  assertEqual(otherUser.originalFileName, 'logo.png', 'another user keeps the plain name')
  const dotted = await service.createUpload({ userId: 'user-1', plan: 'free', file: validPng, originalFileName: 'my.logo.v2.png', mimeType: 'image/png' })
  const dottedAgain = await service.createUpload({ userId: 'user-1', plan: 'free', file: validPng, originalFileName: 'my.logo.v2.png', mimeType: 'image/png' })
  assertEqual(dotted.originalFileName, 'my.logo.v2.png', 'a dotted name is kept')
  assertEqual(dottedAgain.originalFileName, 'my.logo.v2 (2).png', 'the counter goes before the last extension only')
  // A user who already has "name (2).ext" still gets a free name.
  await service.createUpload({ userId: 'user-5', plan: 'free', file: validPng, originalFileName: 'emblem (2).png', mimeType: 'image/png' })
  const e1 = await service.createUpload({ userId: 'user-5', plan: 'free', file: validPng, originalFileName: 'emblem.png', mimeType: 'image/png' })
  const e2 = await service.createUpload({ userId: 'user-5', plan: 'free', file: validPng, originalFileName: 'emblem.png', mimeType: 'image/png' })
  assertEqual(e1.originalFileName, 'emblem.png', 'first "emblem.png"')
  assertEqual(e2.originalFileName, 'emblem (3).png', 'the next free number skips an existing "(2)"')
  console.log('PASS: re-uploading a file name succeeds as a numbered copy (no 409), per user, with separate storage keys')

  // 2a. Many repeats: after the numbered copies a short id suffix keeps names unique.
  const manyNames = new Set<string>()
  for (let i = 0; i < 12; i++) {
    const copy = await service.createUpload({ userId: 'user-many', plan: 'free', file: validPng, originalFileName: 'many.png', mimeType: 'image/png' })
    manyNames.add(copy.originalFileName)
  }
  assertEqual(manyNames.size, 12, 'twelve uploads of one name get twelve distinct names')
  assertTrue([...manyNames].some((name) => /^many \([0-9a-f]{8}\)\.png$/.test(name)), 'past the numbered copies a short id suffix is used')
  console.log('PASS: twelve repeats of one file name all succeed with distinct names')

  // 2b. Race: concurrent identical uploads (a double click, two tabs) all get past
  // the name lookup together; the losers of the atomic insert retry with the next
  // free name instead of failing. Four requests -> four uploads, four R2 objects.
  const racingR2 = createFakeR2Client()
  const racingRepo = new InMemoryUploadsRepository()
  const racingService = new UploadService(new StorageService(racingR2, 'test-secret'), racingRepo)
  const raced = await Promise.all(
    [0, 1, 2, 3].map(() => racingService.createUpload({ userId: 'race-user', plan: 'free', file: validPng, originalFileName: 'race.png', mimeType: 'image/png' })),
  )
  assertEqual(new Set(raced.map((row) => row.originalFileName)).size, 4, 'four concurrent identical uploads get four distinct names')
  assertEqual((await racingRepo.listAll()).length, 4, 'four upload rows')
  assertEqual(racingR2.objects.size, 4, 'four stored files, no orphans')
  console.log('PASS: concurrent uploads of one file name all succeed with distinct names')

  // 2c. The database's own guarantee is unchanged: the repository still refuses
  // two rows with one (user, name) pair, so the service must never rely on it for UX.
  const raceUpload = (id: string) => ({
    id,
    userId: 'race-user-2',
    originalFileName: 'race.png',
    mimeType: 'image/png',
    sizeBytes: 10,
    storageKey: `uploads/race-user-2/${id}.png`,
    status: 'stored' as const,
    createdAt: new Date().toISOString(),
  })
  const rawRepo = new InMemoryUploadsRepository()
  const raceOutcomes = await Promise.allSettled([rawRepo.create(raceUpload('race-1')), rawRepo.create(raceUpload('race-2'))])
  assertEqual(raceOutcomes.filter((outcome) => outcome.status === 'fulfilled').length, 1, 'repository: exactly one row per (user, name)')
  console.log('PASS: repository.create() still enforces (user, file name) uniqueness atomically')

  // 2d. If the name can never be won (the insert keeps conflicting), the upload
  // fails cleanly: a ConflictError, and the stored file is deleted (no orphan).
  const stuckR2 = createFakeR2Client()
  const stuckRepo = new InMemoryUploadsRepository()
  stuckRepo.create = async (row) => {
    throw new ConflictError(`A file named "${row.originalFileName}" has already been uploaded`)
  }
  const stuckService = new UploadService(new StorageService(stuckR2, 'test-secret'), stuckRepo)
  await assertRejects(
    () => stuckService.createUpload({ userId: 'user-1', plan: 'free', file: validPng, originalFileName: 'stuck.png', mimeType: 'image/png' }),
    /already been uploaded/,
    'a name that can never be won',
  )
  assertEqual(stuckR2.objects.size, 0, 'the stored file is deleted when the row cannot be written')
  console.log('PASS: an upload whose row can never be written fails cleanly and leaves no stored file')

  // 2e. Rejected uploads leave nothing behind: no row, no stored file.
  const rowsBefore = (await repository.listAll()).length
  const filesBefore = r2.objects.size
  for (const bad of [
    { file: new TextEncoder().encode('#!/bin/sh').buffer as ArrayBuffer, name: 'shell2.png', type: 'image/png' },
    { file: new ArrayBuffer(0), name: 'empty2.png', type: 'image/png' },
    { file: validPng, name: 'doc2.pdf', type: 'application/pdf' },
  ]) {
    await service.createUpload({ userId: 'user-1', plan: 'free', file: bad.file, originalFileName: bad.name, mimeType: bad.type }).then(
      () => { throw new Error(`${bad.name} should have been rejected`) },
      () => {},
    )
  }
  assertEqual((await repository.listAll()).length, rowsBefore, 'rejected uploads create no rows')
  assertEqual(r2.objects.size, filesBefore, 'rejected uploads store no files')
  console.log('PASS: rejected uploads create no row and store no file')

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

  // 6b. Decompression bomb: a tiny file whose PNG header declares 30000x30000.
  const bomb = pngBytes(64)
  const bombView = new DataView(bomb)
  new Uint8Array(bomb).set([0x49, 0x48, 0x44, 0x52], 12) // "IHDR"
  bombView.setUint32(16, 30000)
  bombView.setUint32(20, 30000)
  await assertRejects(
    () =>
      service.createUpload({
        userId: 'user-2',
        plan: 'free',
        file: bomb,
        originalFileName: 'bomb.png',
        mimeType: 'image/png',
      }),
    /megapixels/,
    'decompression bomb',
  )
  console.log('PASS: decompression-bomb header rejected at upload time')

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
