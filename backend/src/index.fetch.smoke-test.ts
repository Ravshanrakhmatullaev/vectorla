// Local smoke test for the Worker's fetch() wrapper (Phase 21): API
// versioning (/api/v1 prefix), the standard response envelope on a real
// route, CORS (preflight + actual requests), X-Response-Time/X-Request-Id
// headers, and the served OpenAPI document. No wrangler dev needed.
//
// Run with: npx tsx src/index.fetch.smoke-test.ts (from inside backend/)
import worker from './index'
import { loadDecoderWasmModules } from './testSupport/wasmTestFixtures'
import type { Env } from './env'
import type { R2Bucket, Queue } from '@cloudflare/workers-types'
import type { ConversionQueueMessage } from './integrations/queue'

function assertEqual<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
  }
}

function assertTrue(condition: boolean, message: string): void {
  if (!condition) throw new Error(message)
}

async function createFakeEnv(
  environment: Env['ENVIRONMENT'] = 'development',
  configured = false,
): Promise<Env> {
  const { png, jpeg, webp } = await loadDecoderWasmModules()
  return {
    UPLOADS_BUCKET: {} as R2Bucket,
    CONVERSION_QUEUE: {} as Queue<ConversionQueueMessage>,
    SUPABASE_URL: configured ? 'https://test.supabase.co' : '',
    SUPABASE_SERVICE_ROLE_KEY: configured ? 'test-service-role-key' : '',
    DOWNLOAD_URL_SECRET: configured || environment === 'development' ? 'test-secret' : '',
    VECTORIZATION_PROVIDER: 'placeholder',
    PNG_DECODER_WASM: png,
    JPEG_DECODER_WASM: jpeg,
    WEBP_DECODER_WASM: webp,
    ENVIRONMENT: environment,
  }
}

async function run() {
  const env = await createFakeEnv()

  // 1. API versioning: an unversioned path 404s, pointing at /api/v1.
  const unversionedRes = await worker.fetch(new Request('http://localhost/api/health'), env)
  assertEqual(unversionedRes.status, 404, 'unversioned /api/health 404s')
  const unversionedBody = (await unversionedRes.json()) as { success: boolean; error: { code: string; message: string } }
  assertEqual(unversionedBody.success, false, 'unversioned path returns an error envelope')
  assertEqual(unversionedBody.error.code, 'NOT_FOUND', 'unversioned path error code')
  assertTrue(unversionedBody.error.message.includes('/api/v1'), 'the 404 message points at the versioned path')
  console.log('PASS: an unversioned path 404s with a message pointing at /api/v1')

  // 2. GET /api/v1/health — the standard envelope, plus requestId/timing headers.
  const healthRes = await worker.fetch(new Request('http://localhost/api/v1/health'), env)
  assertEqual(healthRes.status, 200, 'status for GET /api/v1/health')
  const healthBody = (await healthRes.json()) as { success: boolean; data: { status: string }; requestId: string }
  assertEqual(healthBody.success, true, 'health response is a success envelope')
  assertEqual(healthBody.data.status, 'ok', 'health data.status is ok')
  assertTrue(healthBody.requestId.length > 0, 'health response includes a requestId')
  assertTrue(/^\d+ms$/.test(healthRes.headers.get('X-Response-Time') ?? ''), 'X-Response-Time header is present and well-formed')
  assertEqual(healthRes.headers.get('X-Request-Id'), healthBody.requestId, 'X-Request-Id header matches the body requestId')
  console.log('PASS: GET /api/v1/health returns the standard envelope with timing/request-id headers')

  // 3. Every request gets its own requestId.
  const secondHealthRes = await worker.fetch(new Request('http://localhost/api/v1/health'), env)
  const secondHealthBody = (await secondHealthRes.json()) as { requestId: string }
  assertTrue(secondHealthBody.requestId !== healthBody.requestId, 'each request gets a distinct requestId')
  console.log('PASS: requestId is unique per request')

  // 4. GET /api/v1/openapi.json — served as raw JSON, not wrapped in the envelope.
  const openapiRes = await worker.fetch(new Request('http://localhost/api/v1/openapi.json'), env)
  assertEqual(openapiRes.status, 200, 'status for GET /api/v1/openapi.json')
  const openapiBody = (await openapiRes.json()) as { openapi: string; paths: Record<string, unknown> }
  assertTrue(openapiBody.openapi.startsWith('3.'), 'the served document declares an OpenAPI 3.x version')
  assertTrue('/uploads' in openapiBody.paths, 'the OpenAPI document documents /uploads')
  assertTrue('/download' in openapiBody.paths, 'the OpenAPI document documents /download')
  console.log('PASS: GET /api/v1/openapi.json serves the OpenAPI document')

  // 5. CORS preflight — an allowed dev origin gets the standard CORS headers back.
  const preflightRes = await worker.fetch(
    new Request('http://localhost/api/v1/health', {
      method: 'OPTIONS',
      headers: { Origin: 'http://localhost:5173', 'Access-Control-Request-Method': 'GET' },
    }),
    env,
  )
  assertEqual(preflightRes.status, 204, 'preflight response status')
  assertEqual(preflightRes.headers.get('Access-Control-Allow-Origin'), 'http://localhost:5173', 'preflight echoes the allowed dev origin')
  assertTrue((preflightRes.headers.get('Access-Control-Allow-Methods') ?? '').includes('GET'), 'preflight allows GET')
  assertTrue((preflightRes.headers.get('Access-Control-Allow-Headers') ?? '').includes('X-Test-User-Id'), 'development preflight allows the test identity header')
  console.log('PASS: CORS preflight succeeds for an allowed dev origin')

  // 6. Localhost CORS is denied in both staging and production.
  for (const environment of ['staging', 'production'] as const) {
    const lockedEnv = await createFakeEnv(environment, true)
    const disallowedPreflightRes = await worker.fetch(
      new Request('http://localhost/api/v1/health', { method: 'OPTIONS', headers: { Origin: 'http://localhost:5173' } }),
      lockedEnv,
    )
    assertEqual(
      disallowedPreflightRes.headers.get('Access-Control-Allow-Origin'),
      null,
      `dev origins are not allowed in ${environment}`,
    )
    const productionOriginPreflight = await worker.fetch(
      new Request('http://localhost/api/v1/health', { method: 'OPTIONS', headers: { Origin: 'https://vectorla.app' } }),
      lockedEnv,
    )
    assertEqual(
      (productionOriginPreflight.headers.get('Access-Control-Allow-Headers') ?? '').includes('X-Test-User-Id'),
      false,
      `test identity header is not allowed in ${environment}`,
    )
  }
  console.log('PASS: CORS does not allow a localhost origin in staging or production')

  // 7. An actual (non-preflight) request from an allowed origin gets the CORS header too.
  const corsRes = await worker.fetch(
    new Request('http://localhost/api/v1/health', { headers: { Origin: 'https://vectorla.app' } }),
    env,
  )
  assertEqual(corsRes.headers.get('Access-Control-Allow-Origin'), 'https://vectorla.app', 'a real request from an allowed origin gets the CORS header')
  console.log('PASS: a normal request from an allowed origin gets Access-Control-Allow-Origin')

  // 8. A request with no Origin header (e.g. server-to-server) gets no CORS header, and still succeeds.
  const noOriginRes = await worker.fetch(new Request('http://localhost/api/v1/health'), env)
  assertEqual(noOriginRes.status, 200, 'a request with no Origin header still succeeds')
  assertEqual(noOriginRes.headers.get('Access-Control-Allow-Origin'), null, 'no CORS header is added when there is no Origin')
  console.log('PASS: a request with no Origin header is unaffected by CORS logic')

  // 9. Staging/production fail closed before serving even public routes when
  // required Supabase or download-signing secrets are absent.
  for (const environment of ['staging', 'production'] as const) {
    const missingSecretsEnv = await createFakeEnv(environment)
    const response = await worker.fetch(new Request('http://localhost/api/v1/health'), missingSecretsEnv)
    assertEqual(response.status, 500, `missing secrets fail closed in ${environment}`)
    const body = (await response.json()) as { success: boolean; error: { code: string } }
    assertEqual(body.success, false, `missing-secret response is an error in ${environment}`)
    assertEqual(body.error.code, 'INTERNAL_ERROR', `missing-secret error code in ${environment}`)
  }
  console.log('PASS: staging and production fail closed when required backend secrets are missing')

  console.log('\nAll index.fetch() wrapper smoke tests passed.')
}

run().catch((error: unknown) => {
  console.error('Smoke test failed:', error)
  throw error
})
