// Local smoke test for GET /api/v1/download — calls the real route handler
// directly with a fake Env, driving a job all the way through the real
// queue() consumer to get a genuinely completed conversion with real bytes
// in the fake R2 bucket, no wrangler dev needed. Auth uses the dev-only
// X-Test-User-Id bypass (see middleware/requireAuth.ts).
//
// Run with: npx tsx src/routes/download.smoke-test.ts (from inside backend/)
import worker from '../index'
import { handleUploadsRoute } from './uploads'
import { handleDownloadRoute } from './download'
import { createCreditsService } from '../services/CreditsService'
import { createConversionsRepository } from '../repositories/createConversionsRepository'
import { StorageService } from '../services/StorageService'
import { createR2Client } from '../integrations/r2'
import { loadDecoderWasmModules, createTestPng } from '../testSupport/wasmTestFixtures'
import { readSuccessBody, readErrorBody, TEST_REQUEST_ID } from '../testSupport/apiTestHelpers'
import type { Env } from '../env'
import type { R2Bucket, Queue, Message, MessageBatch } from '@cloudflare/workers-types'
import type { ConversionQueueMessage } from '../integrations/queue'

function assertEqual<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
  }
}

function assertTrue(condition: boolean, message: string): void {
  if (!condition) throw new Error(message)
}

function arrayBufferToStream(buffer: ArrayBuffer): ReadableStream {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(buffer))
      controller.close()
    },
  })
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
      return value ? ({ body: arrayBufferToStream(value) } as never) : null
    },
    async delete(key: string) {
      store.delete(key)
    },
  } as unknown as R2Bucket

  const queue = {
    async send() {},
    async sendBatch() {},
  } as unknown as Queue<ConversionQueueMessage>

  const { png, jpeg, webp } = await loadDecoderWasmModules()

  return {
    UPLOADS_BUCKET: bucket,
    CONVERSION_QUEUE: queue,
    SUPABASE_URL: '',
    SUPABASE_SERVICE_ROLE_KEY: '',
    DOWNLOAD_URL_SECRET: 'test-secret',
    VECTORIZATION_PROVIDER: 'placeholder',
    PNG_DECODER_WASM: png,
    JPEG_DECODER_WASM: jpeg,
    WEBP_DECODER_WASM: webp,
    ENVIRONMENT: 'development',
  }
}

function createFakeMessage(body: ConversionQueueMessage): Message<ConversionQueueMessage> {
  return {
    id: 'fake-message-id',
    timestamp: new Date(),
    body,
    attempts: 1,
    ack() {},
    retry() {},
  } as unknown as Message<ConversionQueueMessage>
}

function createFakeBatch(messages: Message<ConversionQueueMessage>[]): MessageBatch<ConversionQueueMessage> {
  return {
    messages,
    queue: 'vectorla-conversions',
    metadata: {} as never,
    retryAll() {},
    ackAll() {},
  } as unknown as MessageBatch<ConversionQueueMessage>
}

async function runJobToCompletion(env: Env, jobId: string): Promise<void> {
  if (!worker.queue) throw new Error('worker.queue is not defined')
  await worker.queue(createFakeBatch([createFakeMessage({ jobId })]), env)
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

// downloadUrl is already the full relative path (e.g. "/api/v1/download?...")
// returned by StorageService.getSignedDownloadUrl — see that file.
function downloadRequest(userId: string | null, downloadUrl: string): Request {
  const headers: Record<string, string> = {}
  if (userId) headers['X-Test-User-Id'] = userId
  return new Request(`http://localhost${downloadUrl}`, { method: 'GET', headers })
}

async function uploadAndComplete(env: Env, userId: string): Promise<{ conversionId: string; storageKey: string }> {
  // Phase 19: the queue consumer now really decodes+traces this file, so it
  // must be a genuinely valid PNG, not just a placeholder.
  const file = new File([await createTestPng()], 'logo.png', { type: 'image/png' })
  const uploadRes = await handleUploadsRoute(makeUploadRequest(userId, { file }), env, TEST_REQUEST_ID)
  const { job } = await readSuccessBody<{ job: { id: string } }>(uploadRes)
  await runJobToCompletion(env, job.id)

  const conversions = createConversionsRepository(env)
  const [conversion] = await conversions.findByUserId(userId)
  if (!conversion) throw new Error(`Expected a completed conversion for ${userId}`)
  return { conversionId: conversion.id, storageKey: conversion.storageKey }
}

async function run() {
  const env = await createFakeEnv()
  const creditsService = createCreditsService(env)
  await creditsService.grantMonthlyCredits('dl-user', 'free')
  await creditsService.grantMonthlyCredits('dl-user-2', 'free')

  const storage = new StorageService(createR2Client(env.UPLOADS_BUCKET), env.DOWNLOAD_URL_SECRET)

  const { conversionId, storageKey } = await uploadAndComplete(env, 'dl-user')
  const validUrl = await storage.getSignedDownloadUrl(storageKey)
  assertTrue(validUrl.startsWith('/api/v1/download?'), 'signed download URLs point at the versioned /api/v1/download route')

  // 1. Valid download: 200, correct headers, correct body — the one endpoint
  // whose success response is NOT the standard envelope (raw file bytes).
  const okRes = await handleDownloadRoute(downloadRequest('dl-user', validUrl), env, TEST_REQUEST_ID)
  assertEqual(okRes.status, 200, 'status for a valid download')
  assertEqual(okRes.headers.get('Content-Type'), 'image/svg+xml', 'Content-Type for an svg conversion')
  assertTrue(
    (okRes.headers.get('Content-Disposition') ?? '').includes(`vectorla-${conversionId}.svg`),
    'Content-Disposition names the file after the conversion',
  )
  assertEqual(okRes.headers.get('Cache-Control'), 'private, max-age=0, no-store', 'Cache-Control forbids caching')
  const body = await okRes.text()
  assertTrue(body.startsWith('<svg'), 'response body is a real traced SVG')
  assertTrue(body.includes('<path'), 'response body contains at least one traced path')
  console.log('PASS: 200 OK for a valid download, with correct headers and streamed content')

  // 2. Expired URL: 410
  const expiredUrl = await storage.getSignedDownloadUrl(storageKey, -10)
  const expiredRes = await handleDownloadRoute(downloadRequest('dl-user', expiredUrl), env, TEST_REQUEST_ID)
  assertEqual(expiredRes.status, 410, 'status for an expired download URL')
  assertEqual((await readErrorBody(expiredRes)).code, 'CONFLICT', 'error code for an expired download URL')
  console.log('PASS: 410 Gone for an expired download URL')

  // 3. Invalid signature: 401
  const tamperedUrl = validUrl.replace(/sig=[0-9a-f]+/, 'sig=0000000000000000000000000000000000000000000000000000000000000000')
  const tamperedRes = await handleDownloadRoute(downloadRequest('dl-user', tamperedUrl), env, TEST_REQUEST_ID)
  assertEqual(tamperedRes.status, 401, 'status for a tampered/invalid signature')
  assertEqual((await readErrorBody(tamperedRes)).code, 'UNAUTHORIZED', 'error code for an invalid signature')
  console.log('PASS: 401 Unauthorized for an invalid download signature')

  // 4. Missing signature params entirely: 401
  const noParamsRes = await handleDownloadRoute(downloadRequest('dl-user', '/api/v1/download'), env, TEST_REQUEST_ID)
  assertEqual(noParamsRes.status, 401, 'status for missing signature params')
  console.log('PASS: 401 Unauthorized when the signature query params are missing')

  // 5. No auth at all: 401
  const noAuthRes = await handleDownloadRoute(downloadRequest(null, validUrl), env, TEST_REQUEST_ID)
  assertEqual(noAuthRes.status, 401, 'status for a request with no auth')
  console.log('PASS: 401 Unauthorized for a request with no Authorization/X-Test-User-Id header')

  // 6. Unauthorized access: a different authenticated user than the conversion's owner (403)
  const forbiddenRes = await handleDownloadRoute(downloadRequest('someone-else', validUrl), env, TEST_REQUEST_ID)
  assertEqual(forbiddenRes.status, 403, 'status when the caller does not own the conversion')
  assertEqual((await readErrorBody(forbiddenRes)).code, 'FORBIDDEN', 'error code when the caller does not own the conversion')
  console.log('PASS: 403 Forbidden when the authenticated caller does not own the conversion')

  // 7. Unknown conversion (valid signature over a key with no matching Conversion row): 404
  const unknownKeyUrl = await storage.getSignedDownloadUrl('conversions/nobody/nothing/output.svg')
  const unknownRes = await handleDownloadRoute(downloadRequest('dl-user', unknownKeyUrl), env, TEST_REQUEST_ID)
  assertEqual(unknownRes.status, 404, 'status for a signed URL over a key with no Conversion row')
  assertEqual((await readErrorBody(unknownRes)).code, 'NOT_FOUND', 'error code for an unknown conversion')
  console.log('PASS: 404 Not Found when no Conversion row matches the signed key')

  // 8. Missing object in R2 despite a real Conversion row (data-integrity edge case): 404
  const { storageKey: storageKey2 } = await uploadAndComplete(env, 'dl-user-2')
  const url2 = await storage.getSignedDownloadUrl(storageKey2)
  await createR2Client(env.UPLOADS_BUCKET).delete(storageKey2)
  const missingObjectRes = await handleDownloadRoute(downloadRequest('dl-user-2', url2), env, TEST_REQUEST_ID)
  assertEqual(missingObjectRes.status, 404, 'status when the R2 object itself is missing')
  console.log('PASS: 404 Not Found when the Conversion row exists but the R2 object does not')

  console.log('\nAll GET /api/v1/download route smoke tests passed.')
}

run().catch((error: unknown) => {
  console.error('Smoke test failed:', error)
  throw error
})
