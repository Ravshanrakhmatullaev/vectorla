// Local smoke test for requireAuth (missing/malformed header, 401 cases, and
// the dev-only X-Test-User-Id bypass) and AuthService.verifyToken (against a
// fake SupabaseClient-shaped object, so this needs no real Supabase project
// or real JWTs — the real network call to Supabase's Auth server is the one
// thing this can't exercise locally).
//
// Run with: npx tsx src/middleware/requireAuth.smoke-test.ts (from inside backend/)
import { requireAuth } from './requireAuth'
import { AuthService } from '../services/AuthService'
import type { Env } from '../env'
import type { R2Bucket, Queue } from '@cloudflare/workers-types'
import type { ConversionQueueMessage } from '../integrations/queue'
import type { SupabaseClient } from '@supabase/supabase-js'

function assertEqual<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
  }
}

async function assertRejects(fn: () => Promise<unknown>, pattern: RegExp, message: string): Promise<void> {
  try {
    await fn()
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    if (!pattern.test(msg)) throw new Error(`${message}: error "${msg}" did not match ${pattern}`)
    return
  }
  throw new Error(`${message}: expected the call to reject, but it resolved`)
}

function createFakeEnv(environment: Env['ENVIRONMENT'] = 'development'): Env {
  return {
    UPLOADS_BUCKET: {} as R2Bucket,
    CONVERSION_QUEUE: {} as Queue<ConversionQueueMessage>,
    SUPABASE_URL: '',
    SUPABASE_SERVICE_ROLE_KEY: '',
    DOWNLOAD_URL_SECRET: 'test-secret',
    VECTORIZATION_PROVIDER: 'placeholder',
    ENVIRONMENT: environment,
  }
}

function createFakeSupabaseClient(
  result: { userId: string } | 'invalid',
): SupabaseClient {
  return {
    auth: {
      async getUser(_token: string) {
        if (result === 'invalid') {
          return { data: { user: null }, error: new Error('invalid token') }
        }
        return { data: { user: { id: result.userId } }, error: null }
      },
    },
  } as unknown as SupabaseClient
}

async function run() {
  // 1. AuthService.verifyToken — valid token
  const validService = new AuthService(createFakeSupabaseClient({ userId: 'user-42' }))
  const verified = await validService.verifyToken('valid-token')
  assertEqual(verified.userId, 'user-42', 'verifyToken extracts the authenticated user id')
  console.log('PASS: AuthService.verifyToken returns the user id for a valid token')

  // 2. AuthService.verifyToken — invalid/expired token
  const invalidService = new AuthService(createFakeSupabaseClient('invalid'))
  await assertRejects(() => invalidService.verifyToken('bad-token'), /Invalid or expired token/, 'invalid token')
  console.log('PASS: AuthService.verifyToken rejects an invalid/expired token')

  // 3. requireAuth — missing Authorization header, no test bypass header (401)
  const devEnv = createFakeEnv('development')
  await assertRejects(
    () => requireAuth(new Request('http://localhost/api/jobs'), devEnv),
    /Missing Authorization header/,
    'no auth at all',
  )
  console.log('PASS: requireAuth rejects a request with no auth (401 case)')

  // 4. requireAuth — malformed Authorization header (401)
  await assertRejects(
    () => requireAuth(new Request('http://localhost/api/jobs', { headers: { Authorization: 'Basic abc123' } }), devEnv),
    /Malformed Authorization header/,
    'malformed auth header',
  )
  console.log('PASS: requireAuth rejects a malformed Authorization header (401 case)')

  // 5. requireAuth — dev-only X-Test-User-Id bypass works outside production
  const bypassed = await requireAuth(
    new Request('http://localhost/api/jobs', { headers: { 'X-Test-User-Id': 'dev-user' } }),
    devEnv,
  )
  assertEqual(bypassed.userId, 'dev-user', 'the X-Test-User-Id bypass returns that id')
  console.log('PASS: requireAuth honors the X-Test-User-Id bypass outside production')

  // 6. requireAuth — the bypass never activates in production
  const prodEnv = createFakeEnv('production')
  await assertRejects(
    () => requireAuth(new Request('http://localhost/api/jobs', { headers: { 'X-Test-User-Id': 'dev-user' } }), prodEnv),
    /Missing Authorization header/,
    'bypass attempted in production',
  )
  console.log('PASS: requireAuth ignores X-Test-User-Id in production (must use a real token)')

  console.log('\nAll requireAuth/AuthService smoke tests passed.')
}

run().catch((error: unknown) => {
  console.error('Smoke test failed:', error)
  throw error
})
