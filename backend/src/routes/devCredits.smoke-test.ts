// Local smoke test for POST /api/v1/dev/credits/grant — calls the real route
// handler directly with a fake Env, no wrangler dev needed.
//
// Run with: npx tsx src/routes/devCredits.smoke-test.ts (from inside backend/)
import { handleDevCreditsGrantRoute } from './devCredits'
import { createCreditsService } from '../services/CreditsService'
import { loadDecoderWasmModules } from '../testSupport/wasmTestFixtures'
import { readSuccessBody, readErrorBody, TEST_REQUEST_ID } from '../testSupport/apiTestHelpers'
import type { Env } from '../env'
import type { R2Bucket, Queue } from '@cloudflare/workers-types'
import type { ConversionQueueMessage } from '../integrations/queue'
import type { CreditTransaction } from '../types'

type EnvironmentName = Env['ENVIRONMENT']

function assertEqual<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
  }
}

async function createFakeEnv(environment: EnvironmentName): Promise<Env> {
  // This route never touches R2/the queue/wasm decoding, but Env still
  // requires real values for all of them — see routes/jobs.smoke-test.ts for
  // the same pattern.
  const { png, jpeg, webp } = await loadDecoderWasmModules()
  return {
    UPLOADS_BUCKET: {} as unknown as R2Bucket,
    CONVERSION_QUEUE: {} as unknown as Queue<ConversionQueueMessage>,
    // Empty on purpose: falls back to the in-memory CreditsRepository (see
    // createCreditsRepository.ts), so this test needs no real Supabase project.
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

function makeGrantRequest(body: unknown, method = 'POST'): Request {
  return new Request('http://localhost/api/v1/dev/credits/grant', {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: method === 'POST' ? JSON.stringify(body) : undefined,
  })
}

async function run() {
  const devEnv = await createFakeEnv('development')

  // 1. Grants credits in dev — the balance actually increases.
  const res1 = await handleDevCreditsGrantRoute(makeGrantRequest({ userId: 'dev-user-1', amount: 25 }), devEnv, TEST_REQUEST_ID)
  assertEqual(res1.status, 201, 'status for a valid grant')
  const body1 = await readSuccessBody<CreditTransaction>(res1)
  assertEqual(body1.userId, 'dev-user-1', 'transaction references the granted user')
  assertEqual(body1.amount, 25, 'transaction amount matches the requested amount')
  assertEqual(body1.type, 'credit', 'transaction type is credit')

  const balance = await createCreditsService(devEnv).getBalance('dev-user-1')
  assertEqual(balance.balance, 25, 'balance actually increased by the granted amount')
  console.log('PASS: grants credits in development and the balance actually increases')

  // 2. Blocked in production — 404, as if the route doesn't exist, and no balance change.
  const prodEnv = await createFakeEnv('production')
  const res2 = await handleDevCreditsGrantRoute(makeGrantRequest({ userId: 'prod-user-1', amount: 25 }), prodEnv, TEST_REQUEST_ID)
  assertEqual(res2.status, 404, 'status in production')
  assertEqual((await readErrorBody(res2)).code, 'NOT_FOUND', 'error code in production')
  const prodBalance = await createCreditsService(prodEnv).getBalance('prod-user-1')
  assertEqual(prodBalance.balance, 0, 'no balance change for a request blocked in production')
  console.log('PASS: blocked with 404 in production, no balance change')

  // 3. Invalid amount rejected — zero, negative, non-integer, and non-numeric all 400, no balance change.
  for (const amount of [0, -5, 1.5, 'ten', undefined]) {
    const res = await handleDevCreditsGrantRoute(makeGrantRequest({ userId: 'dev-user-2', amount }), devEnv, TEST_REQUEST_ID)
    assertEqual(res.status, 400, `status for invalid amount ${JSON.stringify(amount)}`)
    assertEqual((await readErrorBody(res)).code, 'VALIDATION_ERROR', `error code for invalid amount ${JSON.stringify(amount)}`)
  }
  const untouchedBalance = await createCreditsService(devEnv).getBalance('dev-user-2')
  assertEqual(untouchedBalance.balance, 0, 'no balance change for any rejected invalid amount')
  console.log('PASS: invalid amount (zero, negative, non-integer, non-numeric) rejected with 400, no balance change')

  // 4. Missing userId rejected.
  const res4 = await handleDevCreditsGrantRoute(makeGrantRequest({ amount: 10 }), devEnv, TEST_REQUEST_ID)
  assertEqual(res4.status, 400, 'status for missing userId')
  assertEqual((await readErrorBody(res4)).code, 'VALIDATION_ERROR', 'error code for missing userId')
  console.log('PASS: missing userId rejected with 400')

  // 5. Wrong method rejected (still 404 in production takes precedence, so only checked in dev).
  const res5 = await handleDevCreditsGrantRoute(makeGrantRequest(undefined, 'GET'), devEnv, TEST_REQUEST_ID)
  assertEqual(res5.status, 405, 'status for wrong method')
  console.log('PASS: 405 Method Not Allowed for GET')

  console.log('\nAll POST /api/v1/dev/credits/grant route smoke tests passed.')
}

run().catch((error: unknown) => {
  console.error('Smoke test failed:', error)
  throw error
})
