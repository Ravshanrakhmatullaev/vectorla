// Local smoke test for the provider architecture: only PlaceholderProvider
// actually works, the rest (Potrace/Vision/OpenAI) throw "Not implemented",
// and ProviderFactory selects between them based on env.VECTORIZATION_PROVIDER
// (falling back to "placeholder" for an unset/unrecognized value).
//
// Run with: npx tsx src/providers/ProviderFactory.smoke-test.ts (from inside backend/)
import { createVectorizationProvider } from './ProviderFactory'
import { PlaceholderProvider } from './PlaceholderProvider'
import { PotraceProvider } from './PotraceProvider'
import { VisionProvider } from './VisionProvider'
import { OpenAIProvider } from './OpenAIProvider'
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

function createFakeEnv(provider: Env['VECTORIZATION_PROVIDER']): Env {
  return {
    UPLOADS_BUCKET: {} as R2Bucket,
    CONVERSION_QUEUE: {} as Queue<ConversionQueueMessage>,
    SUPABASE_URL: '',
    SUPABASE_SERVICE_ROLE_KEY: '',
    DOWNLOAD_URL_SECRET: 'test-secret',
    VECTORIZATION_PROVIDER: provider,
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
  // 1. PlaceholderProvider is the only one that works
  const placeholder = new PlaceholderProvider()
  const result = await placeholder.vectorize(fakeUpload)
  assertEqual(result.format, 'svg', 'PlaceholderProvider produces an svg')
  assertTrue(result.data.byteLength > 0, 'PlaceholderProvider produces non-empty output')
  console.log('PASS: PlaceholderProvider.vectorize produces placeholder SVG output')

  // 2. The other three all throw "Not implemented"
  await assertRejects(() => new PotraceProvider().vectorize(fakeUpload), /Not implemented/, 'PotraceProvider')
  console.log('PASS: PotraceProvider.vectorize throws "Not implemented"')

  await assertRejects(() => new VisionProvider().vectorize(fakeUpload), /Not implemented/, 'VisionProvider')
  console.log('PASS: VisionProvider.vectorize throws "Not implemented"')

  await assertRejects(() => new OpenAIProvider().vectorize(fakeUpload), /Not implemented/, 'OpenAIProvider')
  console.log('PASS: OpenAIProvider.vectorize throws "Not implemented"')

  // 3. ProviderFactory selects the right concrete class per env.VECTORIZATION_PROVIDER
  assertTrue(
    createVectorizationProvider(createFakeEnv('placeholder')) instanceof PlaceholderProvider,
    'factory selects PlaceholderProvider',
  )
  assertTrue(
    createVectorizationProvider(createFakeEnv('potrace')) instanceof PotraceProvider,
    'factory selects PotraceProvider',
  )
  assertTrue(
    createVectorizationProvider(createFakeEnv('vision')) instanceof VisionProvider,
    'factory selects VisionProvider',
  )
  assertTrue(
    createVectorizationProvider(createFakeEnv('openai')) instanceof OpenAIProvider,
    'factory selects OpenAIProvider',
  )
  console.log('PASS: ProviderFactory selects the provider matching env.VECTORIZATION_PROVIDER')

  // 4. An unrecognized value falls back to PlaceholderProvider rather than crashing
  const badEnv = {
    ...createFakeEnv('placeholder'),
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
