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
import { MAX_UPLOAD_BODY_BYTES } from '../config'
import { createUploadsRepository } from '../repositories/createUploadsRepository'
import { createJobsRepository } from '../repositories/createJobsRepository'
import { createCreditsRepository } from '../repositories/createCreditsRepository'
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
    store,
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
    upload: { id: string; originalFileName: string; status: string }
    job: { id: string; status: string; uploadId: string; retryCount: number }
  }>(res1)
  assertEqual(body1.upload.originalFileName, 'route-test.png', 'response upload.originalFileName')
  assertEqual(body1.upload.status, 'stored', 'response upload.status')
  assertEqual(body1.job.status, 'queued', 'response job.status')
  assertEqual(body1.job.retryCount, 0, 'response job.retryCount')
  assertTrue(!('storageKey' in (body1.upload as Record<string, unknown>)), 'the storage key is never sent to the client')
  console.log('PASS: 201 Created on successful upload, with an auto-created queued job')

  // Optional preset: "professional" creates the auto job with the
  // Professional preset; any other value keeps the default Quick job.
  const proFile = new File([pngBytes()], 'route-pro.png', { type: 'image/png' })
  const resPro = await handleUploadsRoute(makeUploadRequest('route-user-preset', { file: proFile, preset: 'professional' }), env, TEST_REQUEST_ID)
  assertEqual(resPro.status, 201, 'status for an upload with the professional preset')
  const bodyPro = await readSuccessBody<{ job: { preset: string | null; status: string } }>(resPro)
  assertEqual(bodyPro.job.preset, 'professional', 'the auto-created job carries the professional preset')
  assertEqual(bodyPro.job.status, 'queued', 'the professional job is queued')
  const otherFile = new File([pngBytes()], 'route-other.png', { type: 'image/png' })
  const resOther = await handleUploadsRoute(makeUploadRequest('route-user-preset', { file: otherFile, preset: 'bogus' }), env, TEST_REQUEST_ID)
  assertEqual(resOther.status, 201, 'status for an upload with an unknown preset')
  assertEqual((await readSuccessBody<{ job: { preset: string | null } }>(resOther)).job.preset, null, 'an unknown preset keeps the default Quick job')
  assertEqual(body1.job.status, 'queued', 'no preset still queues a job')
  console.log('PASS: optional "preset" field: professional is applied to the auto job, other values are ignored')

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

  // Regression (staging bug, 2026-10-16): a repeated file name used to be a
  // 409 outside development, shown by the web app as "Upload failed". The
  // route now accepts it in every environment and stores a numbered copy, with
  // its own upload and its own queued job (createUploadsRepository caches one
  // in-memory repository per env, so these calls share state with res1 above).
  const jobsRepo = createJobsRepository(env)
  const duplicateFile = new File([pngBytes()], 'route-test.png', { type: 'image/png' })
  const res3 = await handleUploadsRoute(makeUploadRequest('route-user', { file: duplicateFile }), env, TEST_REQUEST_ID)
  assertEqual(res3.status, 201, 'a repeated file name is accepted, not a 409')
  const body3 = await readSuccessBody<{ upload: { id: string; originalFileName: string }; job: { id: string; uploadId: string; status: string } }>(res3)
  assertEqual(body3.upload.originalFileName, 'route-test (2).png', 'the repeat is stored as a numbered copy')
  assertEqual(body3.job.status, 'queued', 'the repeat gets its own queued job')
  assertTrue(body3.job.id !== body1.job.id && body3.upload.id !== body1.upload.id, 'separate upload and job')
  assertEqual((await jobsRepo.findByUploadId(body3.upload.id)).length, 1, 'exactly one job for the repeated upload')
  console.log('PASS: a repeated file name is accepted with a numbered copy, its own upload and one queued job (no 409)')

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

  // Failed uploads cost nothing and leave nothing behind: no upload row, no
  // job, no ledger entry, no stored file (the whole route, every rejection class).
  const failUser = 'route-user-failures'
  const failEnv = await createFakeEnv()
  const failStore = (failEnv.UPLOADS_BUCKET as unknown as { store: Map<string, ArrayBuffer> }).store
  const failBad: Array<[string, File | undefined, number]> = [
    ['unsupported type', new File([toArrayBuffer('x')], 'doc.pdf', { type: 'application/pdf' }), 415],
    ['wrong extension', new File([pngBytes()], 'pic.jpg', { type: 'image/png' }), 415],
    ['content is not an image', new File([toArrayBuffer('#!/bin/sh')], 'shell.png', { type: 'image/png' }), 415],
    ['empty file', new File([new ArrayBuffer(0)], 'empty.png', { type: 'image/png' }), 400],
    ['over the plan limit', new File([pngBytes(6 * 1024 * 1024)], 'big.png', { type: 'image/png' }), 413],
    ['no file field', undefined, 400],
  ]
  for (const [label, file, status] of failBad) {
    const res = await handleUploadsRoute(makeUploadRequest(failUser, file ? { file } : {}), failEnv, TEST_REQUEST_ID)
    assertEqual(res.status, status, `status for ${label}`)
  }
  assertEqual((await createUploadsRepository(failEnv).listAll()).length, 0, 'failed uploads create no upload rows')
  assertEqual((await createJobsRepository(failEnv).findPageByUserId(failUser, 10, 0)).total, 0, 'failed uploads create no jobs')
  assertEqual((await createCreditsRepository(failEnv).findTransactionsByUserId(failUser)).length, 0, 'failed uploads write no credit ledger entries')
  assertEqual(failStore.size, 0, 'failed uploads store no files in R2')
  // ...and a good upload afterwards still creates exactly one row, one job, one stored file.
  const afterFail = await handleUploadsRoute(makeUploadRequest(failUser, { file: new File([pngBytes()], 'ok.png', { type: 'image/png' }) }), failEnv, TEST_REQUEST_ID)
  assertEqual(afterFail.status, 201, 'a valid upload after the failures')
  assertEqual((await createJobsRepository(failEnv).findPageByUserId(failUser, 10, 0)).total, 1, 'exactly one job after one good upload')
  assertEqual(failStore.size, 1, 'exactly one stored file')
  console.log('PASS: failed uploads create no row, job, ledger entry or stored file')

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

  // 413 — the body limit holds without (or against) Content-Length: a
  // chunked body is cut off once it passes MAX_UPLOAD_BODY_BYTES, a false
  // small Content-Length is ignored, and a declared oversize is refused unread.
  const multipart = async (file: File) => {
    const form = new FormData()
    form.append('file', file)
    const encoded = new Response(form)
    return { bytes: new Uint8Array(await encoded.arrayBuffer()), contentType: encoded.headers.get('Content-Type')! }
  }
  const streamed = (bytes: Uint8Array, contentType: string, headers: Record<string, string> = {}) => {
    let sent = 0
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sent >= bytes.length) return controller.close()
        controller.enqueue(bytes.subarray(sent, sent + 256 * 1024))
        sent += 256 * 1024
      },
    }, { highWaterMark: 0 }) // no read-ahead: `sent` counts only what the route read
    const request = new Request('http://localhost/api/v1/uploads', {
      method: 'POST',
      headers: { 'X-Test-User-Id': 'route-user-5', 'Content-Type': contentType, ...headers },
      body,
      duplex: 'half',
    } as RequestInit)
    return { request, readBytes: () => Math.min(sent, bytes.length) }
  }
  const huge = await multipart(new File([pngBytes(MAX_UPLOAD_BODY_BYTES + 4 * 1024 * 1024)], 'huge.png', { type: 'image/png' }))
  const chunked = streamed(huge.bytes, huge.contentType)
  const res8 = await handleUploadsRoute(chunked.request, env, TEST_REQUEST_ID)
  assertEqual(res8.status, 413, 'chunked body over the limit without Content-Length')
  assertTrue(chunked.readBytes() <= MAX_UPLOAD_BODY_BYTES + 256 * 1024, `reading stopped at the limit (${chunked.readBytes()} bytes read)`)
  const lying = streamed(huge.bytes, huge.contentType, { 'Content-Length': '1000' })
  assertEqual((await handleUploadsRoute(lying.request, env, TEST_REQUEST_ID)).status, 413, 'a false small Content-Length is not trusted')
  const declared = streamed(huge.bytes, huge.contentType, { 'Content-Length': String(huge.bytes.length) })
  assertEqual((await handleUploadsRoute(declared.request, env, TEST_REQUEST_ID)).status, 413, 'a declared oversize is refused')
  assertEqual(declared.readBytes(), 0, 'a declared oversize is refused before reading the body')
  const small = await multipart(new File([pngBytes()], 'chunked-ok.png', { type: 'image/png' }))
  const okChunked = streamed(small.bytes, small.contentType)
  assertEqual((await handleUploadsRoute(okChunked.request, env, TEST_REQUEST_ID)).status, 201, 'a normal chunked upload without Content-Length still works')
  console.log('PASS: upload body limit enforced while reading (chunked, false or missing Content-Length)')

  console.log('\nAll POST /api/v1/uploads route smoke tests passed.')
}

run().catch((error: unknown) => {
  console.error('Smoke test failed:', error)
  throw error
})
