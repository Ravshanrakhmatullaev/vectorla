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
  // 1. Monochrome logo -> potrace
  assertEqual(selectProvider({ imageType: 'logo', isGrayscale: true }), 'potrace', 'monochrome logo routes to potrace')
  console.log('PASS: monochrome logo -> potrace')

  // 2. Colored logo -> placeholder (the ImageTracer engine)
  assertEqual(selectProvider({ imageType: 'logo', isGrayscale: false }), 'placeholder', 'colored logo routes to placeholder (ImageTracer)')
  console.log('PASS: colored logo -> placeholder (ImageTracer)')

  // 3. Illustration -> placeholder, regardless of grayscale
  assertEqual(selectProvider({ imageType: 'illustration', isGrayscale: false }), 'placeholder', 'illustration routes to placeholder (ImageTracer)')
  assertEqual(selectProvider({ imageType: 'illustration', isGrayscale: true }), 'placeholder', 'grayscale illustration still routes to placeholder (ImageTracer)')
  console.log('PASS: illustration -> placeholder (ImageTracer), regardless of grayscale')

  // 4. Photograph -> vision (professional AI provider, future)
  assertEqual(selectProvider({ imageType: 'photo', isGrayscale: false }), 'vision', 'photograph routes to vision')
  assertEqual(selectProvider({ imageType: 'photo', isGrayscale: true }), 'vision', 'grayscale photograph still routes to vision, not potrace')
  console.log('PASS: photograph -> vision, regardless of grayscale')

  console.log('\nAll ProviderSelector smoke tests passed.')
}

run()
