// Local smoke test for the provider architecture: PlaceholderProvider and
// (Phase 24) PotraceProvider both actually work, Vision/OpenAI still throw
// "Not implemented", and ProviderFactory selects between them based on
// env.VECTORIZATION_PROVIDER (falling back to "placeholder" for an
// unset/unrecognized value). See PotraceProvider.smoke-test.ts for
// PotraceProvider's own dedicated coverage.
//
// Run with: npx tsx src/providers/ProviderFactory.smoke-test.ts (from inside backend/)
import { createVectorizationProvider } from './ProviderFactory'
import { PlaceholderProvider } from './PlaceholderProvider'
import { PotraceProvider } from './PotraceProvider'
import { VisionProvider } from './VisionProvider'
import { OpenAIProvider } from './OpenAIProvider'
import { loadDecoderWasmModules, createTestPng } from '../testSupport/wasmTestFixtures'
import type { Env } from '../env'
import type { Upload } from '../types'
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

async function createFakeEnv(provider: Env['VECTORIZATION_PROVIDER']): Promise<Env> {
  const { png, jpeg, webp } = await loadDecoderWasmModules()
  return {
    UPLOADS_BUCKET: {} as R2Bucket,
    CONVERSION_QUEUE: {} as Queue<ConversionQueueMessage>,
    SUPABASE_URL: '',
    SUPABASE_SERVICE_ROLE_KEY: '',
    DOWNLOAD_URL_SECRET: 'test-secret',
    VECTORIZATION_PROVIDER: provider,
    PNG_DECODER_WASM: png,
    JPEG_DECODER_WASM: jpeg,
    WEBP_DECODER_WASM: webp,
    ENVIRONMENT: 'development',
  }
}

const fakeUpload: Upload = {
  id: 'upload-1',
  userId: 'user-1',
  originalFileName: 'logo.png',
  mimeType: 'image/png',
  sizeBytes: 100,
  storageKey: 'uploads/user-1/upload-1/logo.png',
  status: 'stored',
  createdAt: new Date().toISOString(),
}

async function run() {
  const wasm = await loadDecoderWasmModules()

  // 1. PlaceholderProvider is the only one that works — Phase 19 made it a
  // real ImageTracer.js-based engine (see PlaceholderProvider.ts for the
  // full PNG/JPEG/WEBP/invalid/corrupted matrix — this just spot-checks it).
  const placeholder = new PlaceholderProvider(wasm)
  const pngUpload = { ...fakeUpload, mimeType: 'image/png' }
  const result = await placeholder.vectorize(pngUpload, await createTestPng())
  assertEqual(result.format, 'svg', 'PlaceholderProvider produces an svg')
  assertTrue(result.data.byteLength > 0, 'PlaceholderProvider produces non-empty output')
  console.log('PASS: PlaceholderProvider.vectorize produces real traced SVG output')

  // 2. PotraceProvider (Phase 24) also actually works now.
  const potrace = new PotraceProvider(wasm)
  const potraceResult = await potrace.vectorize(pngUpload, await createTestPng())
  assertEqual(potraceResult.format, 'svg', 'PotraceProvider produces an svg')
  assertTrue(potraceResult.data.byteLength > 0, 'PotraceProvider produces non-empty output')
  console.log('PASS: PotraceProvider.vectorize produces real traced SVG output')

  // Vision/OpenAI still throw "Not implemented".
  await assertRejects(
    () => new VisionProvider().vectorize(fakeUpload, new ArrayBuffer(0)),
    /Not implemented/,
    'VisionProvider',
  )
  console.log('PASS: VisionProvider.vectorize throws "Not implemented"')

  await assertRejects(
    () => new OpenAIProvider().vectorize(fakeUpload, new ArrayBuffer(0)),
    /Not implemented/,
    'OpenAIProvider',
  )
  console.log('PASS: OpenAIProvider.vectorize throws "Not implemented"')

  // 3. ProviderFactory selects the right concrete class per env.VECTORIZATION_PROVIDER
  assertTrue(
    createVectorizationProvider(await createFakeEnv('placeholder')) instanceof PlaceholderProvider,
    'factory selects PlaceholderProvider',
  )
  assertTrue(
    createVectorizationProvider(await createFakeEnv('potrace')) instanceof PotraceProvider,
    'factory selects PotraceProvider',
  )
  assertTrue(
    createVectorizationProvider(await createFakeEnv('vision')) instanceof VisionProvider,
    'factory selects VisionProvider',
  )
  assertTrue(
    createVectorizationProvider(await createFakeEnv('openai')) instanceof OpenAIProvider,
    'factory selects OpenAIProvider',
  )
  console.log('PASS: ProviderFactory selects the provider matching env.VECTORIZATION_PROVIDER')

  // 4. An unrecognized value falls back to PlaceholderProvider rather than crashing
  const badEnv = {
    ...(await createFakeEnv('placeholder')),
    VECTORIZATION_PROVIDER: 'not-a-real-provider',
  } as unknown as Env
  assertTrue(
    createVectorizationProvider(badEnv) instanceof PlaceholderProvider,
    'factory falls back to PlaceholderProvider for an unrecognized value',
  )
  console.log('PASS: ProviderFactory falls back to PlaceholderProvider for an unrecognized value')

  console.log('\nAll ProviderFactory smoke tests passed.')
}

run().catch((error: unknown) => {
  console.error('Smoke test failed:', error)
  throw error
})
