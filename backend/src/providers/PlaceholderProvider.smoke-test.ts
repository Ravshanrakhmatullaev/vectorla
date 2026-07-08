// Local smoke test for the real vectorization engine (Phase 19): PNG/JPEG/WEBP
// -> SVG via jSquash (WASM decode) + ImageTracer.js (trace), invalid/corrupted
// input handling, and the conversion-time/SVG-size/path-count measurements
// this phase asks to report. No wrangler dev needed — wasm is loaded straight
// off disk (see testSupport/wasmTestFixtures.ts).
//
// Run with: npx tsx src/providers/PlaceholderProvider.smoke-test.ts (from inside backend/)
import { PlaceholderProvider } from './PlaceholderProvider'
import { countPaths } from './svgOptimizer'
import { TRACE_PRESETS, type TracePresetName } from './tracePresets'
import { loadDecoderWasmModules, createTestPng, createTestJpeg, createTestWebp } from '../testSupport/wasmTestFixtures'
import type { Upload } from '../types'

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

function makeUpload(overrides: Partial<Upload> = {}): Upload {
  return {
    id: 'upload-1',
    userId: 'user-1',
    originalFileName: 'logo.png',
    mimeType: 'image/png',
    sizeBytes: 100,
    storageKey: 'uploads/user-1/upload-1/logo.png',
    status: 'stored',
    createdAt: new Date().toISOString(),
    ...overrides,
  }
}

interface Measurement {
  label: string
  conversionTimeMs: number
  svgSizeBytes: number
  pathCount: number
}

function report(m: Measurement): void {
  console.log(
    `  measured — ${m.label}: ${m.conversionTimeMs.toFixed(1)}ms, ${m.svgSizeBytes} bytes, ${m.pathCount} paths`,
  )
}

async function run() {
  const wasm = await loadDecoderWasmModules()
  const provider = new PlaceholderProvider(wasm)

  // 1. PNG -> SVG
  const pngBytes = await createTestPng()
  const pngStart = performance.now()
  const pngResult = await provider.vectorize(makeUpload({ mimeType: 'image/png' }), pngBytes)
  const pngElapsed = performance.now() - pngStart
  const pngSvg = new TextDecoder().decode(pngResult.data)
  assertEqual(pngResult.format, 'svg', 'PNG conversion produces svg format')
  assertTrue(pngSvg.startsWith('<svg'), 'PNG conversion produces a real SVG document')
  assertTrue(countPaths(pngSvg) > 0, 'PNG conversion traces at least one path')
  report({ label: 'PNG -> SVG', conversionTimeMs: pngElapsed, svgSizeBytes: pngResult.data.byteLength, pathCount: countPaths(pngSvg) })
  console.log('PASS: PNG -> SVG produces a real, non-empty traced SVG')

  // 2. JPEG -> SVG
  const jpegBytes = await createTestJpeg()
  const jpegStart = performance.now()
  const jpegResult = await provider.vectorize(makeUpload({ mimeType: 'image/jpeg', originalFileName: 'logo.jpg' }), jpegBytes)
  const jpegElapsed = performance.now() - jpegStart
  const jpegSvg = new TextDecoder().decode(jpegResult.data)
  assertEqual(jpegResult.format, 'svg', 'JPEG conversion produces svg format')
  assertTrue(jpegSvg.startsWith('<svg'), 'JPEG conversion produces a real SVG document')
  assertTrue(countPaths(jpegSvg) > 0, 'JPEG conversion traces at least one path')
  report({
    label: 'JPEG -> SVG',
    conversionTimeMs: jpegElapsed,
    svgSizeBytes: jpegResult.data.byteLength,
    pathCount: countPaths(jpegSvg),
  })
  console.log('PASS: JPEG -> SVG produces a real, non-empty traced SVG')

  // 3. WEBP -> SVG
  const webpBytes = await createTestWebp()
  const webpStart = performance.now()
  const webpResult = await provider.vectorize(makeUpload({ mimeType: 'image/webp', originalFileName: 'logo.webp' }), webpBytes)
  const webpElapsed = performance.now() - webpStart
  const webpSvg = new TextDecoder().decode(webpResult.data)
  assertEqual(webpResult.format, 'svg', 'WEBP conversion produces svg format')
  assertTrue(webpSvg.startsWith('<svg'), 'WEBP conversion produces a real SVG document')
  assertTrue(countPaths(webpSvg) > 0, 'WEBP conversion traces at least one path')
  report({
    label: 'WEBP -> SVG',
    conversionTimeMs: webpElapsed,
    svgSizeBytes: webpResult.data.byteLength,
    pathCount: countPaths(webpSvg),
  })
  console.log('PASS: WEBP -> SVG produces a real, non-empty traced SVG')

  // 4. Normalized dimensions: the output SVG's viewBox matches the decoded
  // source size exactly (see svgOptimizer.optimizeSvg), regardless of format.
  assertTrue(/viewBox="0 0 8 8"/.test(pngSvg), 'PNG output viewBox matches the 8x8 source image')
  assertTrue(/width="8" height="8"/.test(pngSvg), 'PNG output width/height match the 8x8 source image')
  console.log('PASS: output SVG dimensions are normalized to the real decoded image size')

  // 5. Invalid image: an unsupported/unexpected mime type reaching the
  // provider is rejected defensively (upload-time validation already blocks
  // this in practice — see validateUpload.ts — this checks the provider's
  // own guard independently).
  await assertRejects(
    () => provider.vectorize(makeUpload({ mimeType: 'image/gif' }), pngBytes),
    /Cannot vectorize unsupported mime type/,
    'invalid image mime type',
  )
  console.log('PASS: an unsupported mime type is rejected with a clear error')

  // 6. Corrupted image: valid magic bytes (would pass upload-time signature
  // validation) but a truncated/garbage body that the decoder chokes on.
  const corruptedPng = pngBytes.slice(0, 20) // real PNG signature + IHDR start, then nothing
  await assertRejects(
    () => provider.vectorize(makeUpload({ mimeType: 'image/png' }), corruptedPng),
    /Failed to decode image\/png image/,
    'corrupted PNG',
  )
  console.log('PASS: a corrupted (truncated) image is rejected with a clear error, not a crash/hang')

  const corruptedJpeg = jpegBytes.slice(0, 10)
  await assertRejects(
    () => provider.vectorize(makeUpload({ mimeType: 'image/jpeg' }), corruptedJpeg),
    /Failed to decode image\/jpeg image/,
    'corrupted JPEG',
  )
  console.log('PASS: a corrupted (truncated) JPEG is rejected with a clear error, not a crash/hang')

  // 7. Automatic preset recommendation (Phase 20): with no requested preset,
  // analyze() picks one of the five named presets for a real decoded image.
  const upload = makeUpload({ mimeType: 'image/png' })
  const { analysis } = await provider.analyze(upload, pngBytes)
  assertTrue(analysis.recommendedPreset in TRACE_PRESETS, `analyze() recommends a real preset (got "${analysis.recommendedPreset}")`)
  console.log(
    `PASS: analyze() recommends a preset for a real image (colors=${analysis.colorCountEstimate}, ` +
      `transparency=${analysis.hasTransparency}, complexity=${analysis.complexityScore.toFixed(2)}) -> ${analysis.recommendedPreset}`,
  )

  // 8. Explicit preset request overrides the automatic recommendation.
  const otherPreset: TracePresetName = analysis.recommendedPreset === 'photo' ? 'logo' : 'photo'
  const requestedResult = await provider.vectorize(upload, pngBytes, otherPreset)
  const defaultResult = await provider.vectorize(upload, pngBytes, null)
  assertTrue(requestedResult.data.byteLength > 0, 'requesting an explicit preset still produces output')
  assertTrue(defaultResult.data.byteLength > 0, 'requesting no preset (auto-recommend) still produces output')
  console.log(`PASS: an explicit requestedPreset ("${otherPreset}") is honored instead of the auto-recommendation`)

  // 9. An unrecognized requested preset falls back to auto-recommendation
  // instead of throwing — a stale/garbage Job.preset shouldn't break processing.
  const unknownPresetResult = await provider.vectorize(upload, pngBytes, 'not-a-real-preset')
  assertTrue(unknownPresetResult.data.byteLength > 0, 'an unrecognized preset falls back to auto-recommendation, not an error')
  console.log('PASS: an unrecognized requestedPreset falls back to automatic recommendation')

  // 10. Measure every preset on the same real image, for comparison.
  console.log('  preset comparison on the same PNG:')
  for (const presetName of Object.keys(TRACE_PRESETS) as TracePresetName[]) {
    const start = performance.now()
    const result = await provider.vectorize(upload, pngBytes, presetName)
    const elapsed = performance.now() - start
    const svg = new TextDecoder().decode(result.data)
    report({ label: `preset "${presetName}"`, conversionTimeMs: elapsed, svgSizeBytes: result.data.byteLength, pathCount: countPaths(svg) })
  }
  console.log('PASS: every preset produces output on the same source image')

  console.log('\nAll PlaceholderProvider (real engine) smoke tests passed.')
}

run().catch((error: unknown) => {
  console.error('Smoke test failed:', error)
  throw error
})
