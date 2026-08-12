// Local smoke test for the actual POST /api/v1/uploads route handler — the
// exact function Wrangler invokes, called directly with a fake Env (no real
// R2/Supabase, and no wrangler dev process needed). Auth uses the dev-only
// X-Test-User-Id bypass (see middleware/requireAuth.ts) instead of a real
// Supabase JWT, since ENVIRONMENT is 'development' below.
//
// Run with: npx tsx src/routes/uploads.smoke-test.ts (from inside backend/)
import { handleUploadsRoute } from './uploads'
import { loadDecoderWasmModules } from '../testSupport/wasmTestFixtures'
import { readSuccessBody, readErrorBody, TEST_REQUEST_ID } from '../testSupport/apiTestHelpers'
import type { Env } from '../env'
import type { R2Bucket, Queue } from '@cloudflare/workers-types'
import type { ConversionQueueMessage } from '../integrations/queue'

function assertEqual<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
  }
}

function assertTrue(condition: boolean, message: string): void {
  if (!condition) throw new Error(message)
}

function toArrayBuffer(text: string): ArrayBuffer {
  return new TextEncoder().encode(text).buffer as ArrayBuffer
}

// Phase 17 added magic-byte signature validation (see validateUpload.ts) —
// fixtures declaring image/png must start with the real PNG signature.
function pngBytes(size = 16): ArrayBuffer {
  const buffer = new ArrayBuffer(Math.max(size, 8))
  new Uint8Array(buffer).set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  return buffer
}

function createFakeBucket(shouldFail = false): R2Bucket {
  const store = new Map<string, ArrayBuffer>()
  return {
    async put(key: string, value: ArrayBuffer) {
      if (shouldFail) throw new Error('simulated R2 outage')
      store.set(key, value)
      return null
    },
    async get(key: string) {
      return store.has(key) ? ({ body: null } as never) : null
    },
    async delete(key: string) {
      store.delete(key)
    },
  } as unknown as R2Bucket
}

function createFakeQueue(): Queue<ConversionQueueMessage> {
  return {
    async send() {},
    async sendBatch() {},
  } as unknown as Queue<ConversionQueueMessage>
}

async function createFakeEnv(shouldFail = false, environment: Env['ENVIRONMENT'] = 'development'): Promise<Env> {
  // This test never drives a job through the queue consumer (no real
  // decoding ever runs), but Env still requires real WebAssembly.Module
  // values — see testSupport/wasmTestFixtures.ts.
  const { png, jpeg, webp } = await loadDecoderWasmModules()
  return {
    UPLOADS_BUCKET: createFakeBucket(shouldFail),
    CONVERSION_QUEUE: createFakeQueue(),
    // Left empty on purpose: this makes createUploadsRepository()/createJobsRepository()
    // fall back to their in-memory implementations, so this test needs no real
    // Supabase project.
    SUPABASE_URL: '',
    SUPABASE_SERVICE_ROLE_KEY: '',
    DOWNLOAD_URL_SECRET: 'test-secret',
    VECTORIZATION_PROVIDER: 'placeholder',
    PNG_DECODER_WASM: png,
    JPEG_DECODER_WASM: jpeg,
    WEBP_DECODER_WASM: webp,
    ENVIRONMENT: environment,
  }
}

function makeUploadRequest(userId: string, fields: Record<string, string | File>): Request {
  const form = new FormData()
  for (const [key, value] of Object.entries(fields)) form.append(key, value)
  return new Request('http://localhost/api/v1/uploads', {
    method: 'POST',
    headers: { 'X-Test-User-Id': userId },
    body: form,
  })
}

async function run() {
  const env = await createFakeEnv()

  // 201 on success — Phase 10: response now also includes the auto-created job
  const goodFile = new File([pngBytes()], 'route-test.png', { type: 'image/png' })
  const res1 = await handleUploadsRoute(makeUploadRequest('route-user', { file: goodFile }), env, TEST_REQUEST_ID)
  assertEqual(res1.status, 201, 'status for valid upload')
  const body1 = await readSuccessBody<{
    upload: { originalFileName: string; status: string }
    job: { status: string; uploadId: string; retryCount: number }
  }>(res1)
  assertEqual(body1.upload.originalFileName, 'route-test.png', 'response upload.originalFileName')
  assertEqual(body1.upload.status, 'stored', 'response upload.status')
  assertEqual(body1.job.status, 'queued', 'response job.status')
  assertEqual(body1.job.retryCount, 0, 'response job.retryCount')
  console.log('PASS: 201 Created on successful upload, with an auto-created queued job')

  // 401 — no Authorization header and no test bypass header
  const res0 = await handleUploadsRoute(
    new Request('http://localhost/api/v1/uploads', { method: 'POST', body: new FormData() }),
    env,
    TEST_REQUEST_ID,
  )
  assertEqual(res0.status, 401, 'status for missing auth')
  const error0 = await readErrorBody(res0)
  assertEqual(error0.code, 'UNAUTHORIZED', 'error code for missing auth')
  console.log('PASS: 401 Unauthorized when no Authorization/X-Test-User-Id header is present')

  // 400 — missing file field
  const res2 = await handleUploadsRoute(makeUploadRequest('route-user', {}), env, TEST_REQUEST_ID)
  assertEqual(res2.status, 400, 'status for missing file field')
  assertEqual((await readErrorBody(res2)).code, 'VALIDATION_ERROR', 'error code for missing file field')
  console.log('PASS: 400 Bad Request when "file" field is missing')

  // Local development: a duplicate filename from the same user is no longer
  // a conflict — re-uploading the same sample file while testing must not
  // block the developer (createUploadsRepository caches one in-memory
  // repository per env, so this route-level call does share state with res1
  // above — see createUploadsRepository.ts). The name is disambiguated so
  // the repository's real (userId, originalFileName) uniqueness guarantee,
  // still fully active underneath, is never actually hit.
  const duplicateFile = new File([pngBytes()], 'route-test.png', { type: 'image/png' })
  const res3 = await handleUploadsRoute(makeUploadRequest('route-user', { file: duplicateFile }), env, TEST_REQUEST_ID)
  assertEqual(res3.status, 201, 'a duplicate filename in development is accepted, not a conflict')
  const body3 = await readSuccessBody<{ upload: { originalFileName: string } }>(res3)
  assertTrue(body3.upload.originalFileName !== 'route-test.png', 'the duplicate name is disambiguated, not stored verbatim')
  assertTrue(body3.upload.originalFileName.startsWith('route-test.png ('), 'the disambiguated name still starts with the original name')
  console.log('PASS: a duplicate filename in development is accepted with a disambiguated name, not rejected as a conflict')

  // 415 — unsupported mime type
  const badFile = new File([toArrayBuffer('x')], 'doc.pdf', { type: 'application/pdf' })
  const res4 = await handleUploadsRoute(makeUploadRequest('route-user-2', { file: badFile }), env, TEST_REQUEST_ID)
  assertEqual(res4.status, 415, 'status for unsupported mime type')
  assertEqual((await readErrorBody(res4)).code, 'VALIDATION_ERROR', 'error code for unsupported mime type')
  console.log('PASS: 415 Unsupported Media Type for disallowed mime type')

  // 413 — oversized file (free plan default, 5MB limit)
  const bigFile = new File([pngBytes(6 * 1024 * 1024)], 'big.png', { type: 'image/png' })
  const res5 = await handleUploadsRoute(makeUploadRequest('route-user-3', { file: bigFile, plan: 'business' }), env, TEST_REQUEST_ID)
  assertEqual(res5.status, 413, 'status for oversized file')
  assertEqual((await readErrorBody(res5)).code, 'VALIDATION_ERROR', 'error code for oversized file')
  console.log('PASS: multipart plan spoof is ignored; the authenticated profile free-plan limit returns 413')

  // 405 — wrong HTTP method
  const res6 = await handleUploadsRoute(new Request('http://localhost/api/v1/uploads', { method: 'GET' }), env, TEST_REQUEST_ID)
  assertEqual(res6.status, 405, 'status for wrong method')
  console.log('PASS: 405 Method Not Allowed for GET')

  // 500 — unexpected failure (R2 put throws)
  const brokenEnv = await createFakeEnv(true)
  const okFile = new File([pngBytes()], 'will-fail.png', { type: 'image/png' })
  const res7 = await handleUploadsRoute(makeUploadRequest('route-user-4', { file: okFile }), brokenEnv, TEST_REQUEST_ID)
  assertEqual(res7.status, 500, 'status for unexpected storage failure')
  assertEqual((await readErrorBody(res7)).code, 'INTERNAL_ERROR', 'error code for unexpected storage failure')
  console.log('PASS: 500 Internal Server Error on unexpected storage failure')

  console.log('\nAll POST /api/v1/uploads route smoke tests passed.')
}

run().catch((error: unknown) => {
  console.error('Smoke test failed:', error)
  throw error
})
