// Local smoke test for GET /api/v1/history -- calls the real route handler
// against the in-memory job/conversion repositories, with no Wrangler or
// Supabase credentials.
//
// Run with: npx tsx src/routes/history.smoke-test.ts (from inside backend/)
import { handleHistoryRoute } from './history'
import { createJobsRepository } from '../repositories/createJobsRepository'
import { createConversionsRepository } from '../repositories/createConversionsRepository'
import { readErrorBody, TEST_REQUEST_ID } from '../testSupport/apiTestHelpers'
import type { Env } from '../env'
import type { Conversion, HistoryEntry, Job } from '../types'
import type { R2Bucket, Queue } from '@cloudflare/workers-types'
import type { ConversionQueueMessage } from '../integrations/queue'

interface HistoryResponse {
  success: boolean
  data: HistoryEntry[]
  pagination: { total: number; limit: number; offset: number; hasMore: boolean }
}

function assertEqual<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
  }
}

function createFakeEnv(): Env {
  return {
    UPLOADS_BUCKET: {} as unknown as R2Bucket,
    CONVERSION_QUEUE: {} as unknown as Queue<ConversionQueueMessage>,
    SUPABASE_URL: '',
    SUPABASE_SERVICE_ROLE_KEY: '',
    DOWNLOAD_URL_SECRET: 'test-secret',
    VECTORIZATION_PROVIDER: 'placeholder',
    PNG_DECODER_WASM: {} as WebAssembly.Module,
    JPEG_DECODER_WASM: {} as WebAssembly.Module,
    WEBP_DECODER_WASM: {} as WebAssembly.Module,
    ENVIRONMENT: 'staging',
  }
}

function makeJob(id: string, userId: string, uploadId: string, createdAt: string): Job {
  return {
    id,
    userId,
    uploadId,
    status: 'completed',
    preset: null,
    settings: null,
    errorMessage: null,
    retryCount: 0,
    version: 0,
    createdAt,
    updatedAt: createdAt,
    completedAt: createdAt,
  }
}

function makeConversion(id: string, job: Job): Conversion {
  return {
    id,
    jobId: job.id,
    userId: job.userId,
    format: 'svg',
    storageKey: `conversions/${job.userId}/${job.id}/output.svg`,
    fileSizeBytes: 128,
    downloadUrl: null,
    createdAt: job.createdAt,
  }
}

function makeRequest(userId: string | null, search = '', method = 'GET'): Request {
  const headers = userId ? { 'X-Test-User-Id': userId } : undefined
  return new Request(`http://localhost/api/v1/history${search}`, { method, headers })
}

async function readHistory(response: Response): Promise<HistoryResponse> {
  return (await response.json()) as HistoryResponse
}

async function run() {
  const env = createFakeEnv()
  const jobs = createJobsRepository(env)
  const conversions = createConversionsRepository(env)

  const job1 = await jobs.create(makeJob('job-1', 'history-user', 'upload-1', '2026-01-01T00:00:00.000Z'))
  const job2 = await jobs.create(makeJob('job-2', 'history-user', 'upload-2', '2026-01-02T00:00:00.000Z'))
  const job3 = await jobs.create(makeJob('job-3', 'history-user', 'upload-3', '2026-01-03T00:00:00.000Z'))
  const otherJob = await jobs.create(makeJob('job-other', 'other-user', 'upload-other', '2026-01-04T00:00:00.000Z'))
  await conversions.create(makeConversion('conversion-2', job2))
  await conversions.create(makeConversion('conversion-3', job3))
  await conversions.create({ ...makeConversion('conversion-cross-user', job3), userId: 'other-user' })
  await conversions.create(makeConversion('conversion-other', otherJob))

  const unauthorized = await handleHistoryRoute(makeRequest(null), env, TEST_REQUEST_ID)
  assertEqual(unauthorized.status, 401, 'status without auth')
  assertEqual((await readErrorBody(unauthorized)).code, 'UNAUTHORIZED', 'error code without auth')
  assertEqual(unauthorized.headers.get('Cache-Control'), 'no-store', 'unauthorized response is not cached')
  console.log('PASS: 401 Unauthorized without authentication')

  const firstPage = await handleHistoryRoute(makeRequest('history-user', '?limit=2'), env, TEST_REQUEST_ID)
  const firstPageBody = await readHistory(firstPage)
  assertEqual(firstPage.status, 200, 'status for history list')
  assertEqual(firstPage.headers.get('Cache-Control'), 'no-store', 'successful response is not cached')
  assertEqual(firstPageBody.data.length, 2, 'first page length')
  assertEqual(firstPageBody.data[0]?.jobId, 'job-3', 'history is newest first')
  assertEqual(firstPageBody.data[0]?.conversionIds[0], 'conversion-3', 'conversion is joined to its job')
  assertEqual(firstPageBody.data[0]?.conversionIds.length, 1, 'cross-user conversion is not joined')
  assertEqual(firstPageBody.data[1]?.jobId, 'job-2', 'second newest job')
  assertEqual(firstPageBody.pagination.total, 3, 'total includes only the caller jobs')
  assertEqual(firstPageBody.pagination.hasMore, true, 'first page reports more results')
  assertEqual(firstPageBody.data.every((entry) => entry.userId === 'history-user'), true, 'no other user history is returned')
  console.log('PASS: returns only the authenticated user history, newest first, with conversion ids')

  const secondPage = await handleHistoryRoute(makeRequest('history-user', '?limit=2&offset=2'), env, TEST_REQUEST_ID)
  const secondPageBody = await readHistory(secondPage)
  assertEqual(secondPageBody.data.length, 1, 'second page length')
  assertEqual(secondPageBody.data[0]?.jobId, job1.id, 'offset selects the remaining job')
  assertEqual(secondPageBody.data[0]?.conversionIds.length, 0, 'job without a conversion has an empty id list')
  assertEqual(secondPageBody.pagination.hasMore, false, 'last page reports no more results')
  console.log('PASS: limit/offset pagination and hasMore metadata are correct')

  const capped = await readHistory(await handleHistoryRoute(makeRequest('history-user', '?limit=1000'), env, TEST_REQUEST_ID))
  assertEqual(capped.pagination.limit, 100, 'limit is capped')
  const invalid = await readHistory(await handleHistoryRoute(makeRequest('history-user', '?limit=1.5&offset=-1'), env, TEST_REQUEST_ID))
  assertEqual(invalid.pagination.limit, 20, 'invalid limit uses the default')
  assertEqual(invalid.pagination.offset, 0, 'invalid offset uses zero')
  console.log('PASS: pagination safeguards default invalid values and cap oversized limits')

  const empty = await readHistory(await handleHistoryRoute(makeRequest('nobody'), env, TEST_REQUEST_ID))
  assertEqual(empty.data.length, 0, 'empty history data')
  assertEqual(empty.pagination.total, 0, 'empty history total')
  console.log('PASS: a user with no history receives an empty page')

  const wrongMethod = await handleHistoryRoute(makeRequest('history-user', '', 'POST'), env, TEST_REQUEST_ID)
  assertEqual(wrongMethod.status, 405, 'status for wrong method')
  assertEqual(wrongMethod.headers.get('Cache-Control'), 'no-store', 'method error is not cached')
  console.log('PASS: 405 Method Not Allowed for POST')

  console.log('\nAll GET /api/v1/history route smoke tests passed.')
}

run().catch((error: unknown) => {
  console.error('Smoke test failed:', error)
  throw error
})
