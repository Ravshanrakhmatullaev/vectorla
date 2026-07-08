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

function toArrayBuffer(text: string): ArrayBuffer {
  // TextEncoder().encode().buffer is typed as ArrayBufferLike (which includes
  // SharedArrayBuffer) — this documents that a plain string always yields a
  // real ArrayBuffer, never a SharedArrayBuffer.
  return new TextEncoder().encode(text).buffer as ArrayBuffer
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

async function run() {
  const r2 = createFakeR2Client()
  const storage = new StorageService(r2, 'test-secret')
  const repository = new InMemoryUploadsRepository()
  const service = new UploadService(storage, repository)

  const validPng = toArrayBuffer('fake-png-bytes')

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
  const oversized = new ArrayBuffer(6 * 1024 * 1024)
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
