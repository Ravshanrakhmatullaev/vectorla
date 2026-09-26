// Local smoke test for selectProvider (Phase 21) — pure function, no I/O.
//
// Run with: npx tsx src/providers/ProviderSelector.smoke-test.ts (from inside backend/)
import { selectProvider } from './ProviderSelector'

function assertEqual<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
  }
}

function run(): void {
  // Every image type routes to the Vectorla engine, regardless of grayscale.
  for (const imageType of ['logo', 'illustration', 'photo'] as const) {
    for (const isGrayscale of [true, false]) {
      assertEqual(selectProvider({ imageType, isGrayscale }), 'vectorla', `${imageType} (grayscale=${isGrayscale}) routes to vectorla`)
    }
  }
  console.log('PASS: logo / illustration / photo (color and grayscale) -> vectorla')

  console.log('\nAll ProviderSelector smoke tests passed.')
}

run()
