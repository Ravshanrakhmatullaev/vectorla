// Local smoke test for GET /api/v1/credits -- calls the real route handler
// against the in-memory repository, with no Wrangler/Supabase credentials.
//
// Run with: npx tsx src/routes/credits.smoke-test.ts (from inside backend/)
import { handleCreditsRoute } from './credits'
import { createCreditsService } from '../services/CreditsService'
import { loadDecoderWasmModules } from '../testSupport/wasmTestFixtures'
import { readSuccessBody, readErrorBody, TEST_REQUEST_ID } from '../testSupport/apiTestHelpers'
import type { Env } from '../env'
import type { CreditTransaction } from '../types'
import type { R2Bucket, Queue } from '@cloudflare/workers-types'
import type { ConversionQueueMessage } from '../integrations/queue'

interface CreditsOverview {
  balance: number
  transactions: Array<Omit<CreditTransaction, 'userId'>>
}

function assertEqual<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
  }
}

async function createFakeEnv(): Promise<Env> {
  const { png, jpeg, webp } = await loadDecoderWasmModules()
  return {
    UPLOADS_BUCKET: {} as unknown as R2Bucket,
    CONVERSION_QUEUE: {} as unknown as Queue<ConversionQueueMessage>,
    SUPABASE_URL: '',
    SUPABASE_SERVICE_ROLE_KEY: '',
    DOWNLOAD_URL_SECRET: 'test-secret',
    VECTORIZATION_PROVIDER: 'placeholder',
    PNG_DECODER_WASM: png,
    JPEG_DECODER_WASM: jpeg,
    WEBP_DECODER_WASM: webp,
    ENVIRONMENT: 'staging',
  }
}

function makeRequest(userId?: string, search = '', method = 'GET'): Request {
  const headers = userId ? { 'X-Test-User-Id': userId } : undefined
  return new Request(`http://localhost/api/v1/credits${search}`, { method, headers })
}

async function run() {
  const env = await createFakeEnv()

  const unauthorized = await handleCreditsRoute(makeRequest(), env, TEST_REQUEST_ID)
  assertEqual(unauthorized.status, 401, 'status without auth')
  assertEqual((await readErrorBody(unauthorized)).code, 'UNAUTHORIZED', 'error code without auth')
  assertEqual(unauthorized.headers.get('Cache-Control'), 'no-store', 'unauthorized response is not cached')
  console.log('PASS: 401 Unauthorized without authentication')

  const empty = await handleCreditsRoute(makeRequest('user-1'), env, TEST_REQUEST_ID)
  assertEqual(empty.status, 200, 'status for a new user')
  const emptyBody = await readSuccessBody<CreditsOverview>(empty)
  assertEqual(emptyBody.balance, 0, 'new user balance')
  assertEqual(emptyBody.transactions.length, 0, 'new user transaction count')
  assertEqual(empty.headers.get('Cache-Control'), 'no-store', 'successful response is not cached')
  console.log('PASS: a user with no credit history receives a zero balance and empty transactions')

  const service = createCreditsService(env)
  await service.credit('user-1', 25, 'Initial grant')
  await service.debitCredits('user-1', 2, 'Professional trace', 'job-1')
  await service.credit('user-2', 99, 'Other user grant')

  const populated = await handleCreditsRoute(makeRequest('user-1'), env, TEST_REQUEST_ID)
  const populatedBody = await readSuccessBody<CreditsOverview>(populated)
  assertEqual(populatedBody.balance, 23, 'balance after credit and debit')
  assertEqual(populatedBody.transactions.length, 2, 'only caller transactions are returned')
  assertEqual(
    (populatedBody.transactions[0]?.createdAt ?? '') >= (populatedBody.transactions[1]?.createdAt ?? ''),
    true,
    'transactions are newest first',
  )
  assertEqual(populatedBody.transactions.some((transaction) => transaction.type === 'credit'), true, 'credit is included')
  assertEqual(populatedBody.transactions.some((transaction) => transaction.type === 'debit'), true, 'debit is included')
  assertEqual('userId' in (populatedBody.transactions[0] ?? {}), false, 'internal userId is omitted from transactions')
  console.log('PASS: current balance and caller-scoped recent transactions are returned newest first')

  const limited = await handleCreditsRoute(makeRequest('user-1', '?limit=1'), env, TEST_REQUEST_ID)
  assertEqual((await readSuccessBody<CreditsOverview>(limited)).transactions.length, 1, 'limit query parameter')
  for (let index = 0; index < 105; index++) {
    await service.credit('user-3', 1, `Grant ${index + 1}`)
  }
  const defaultLimited = await handleCreditsRoute(makeRequest('user-3'), env, TEST_REQUEST_ID)
  assertEqual((await readSuccessBody<CreditsOverview>(defaultLimited)).transactions.length, 20, 'default limit')
  const maxLimited = await handleCreditsRoute(makeRequest('user-3', '?limit=1000'), env, TEST_REQUEST_ID)
  assertEqual((await readSuccessBody<CreditsOverview>(maxLimited)).transactions.length, 100, 'maximum limit')
  console.log('PASS: transaction limits honor the requested value, default to 20, and cap at 100')

  const wrongMethod = await handleCreditsRoute(makeRequest('user-1', '', 'POST'), env, TEST_REQUEST_ID)
  assertEqual(wrongMethod.status, 405, 'status for wrong method')
  console.log('PASS: 405 Method Not Allowed for POST')

  console.log('\nAll GET /api/v1/credits route smoke tests passed.')
}

run().catch((error: unknown) => {
  console.error('Smoke test failed:', error)
  throw error
})
