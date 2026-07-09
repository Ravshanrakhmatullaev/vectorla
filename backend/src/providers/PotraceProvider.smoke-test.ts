// Local smoke test for PotraceProvider (Phase 24) — decode/invalid/corrupted
// handling (mirrors PlaceholderProvider.smoke-test.ts), and the task's
// actual comparison requirement: Potrace vs ImageTracer on Logo/QR/
// Signature/Stamp/Icon, measuring SVG size/path count/node count/
// processing time, and confirming vectorize() automatically keeps whichever
// measured better rather than blindly trusting ProviderSelector's routing.
//
// Run with: npx tsx src/providers/PotraceProvider.smoke-test.ts (from inside backend/)
import { PotraceProvider } from './PotraceProvider'
import { PlaceholderProvider } from './PlaceholderProvider'
import { isTracePresetName } from './tracePresets'
import { measureSvgQuality, type SvgQualityMetrics } from '../qualityTesting/svgQualityMetrics'
import { buildQualityTestImages, type QualityTestImage } from '../testSupport/qualityTestImages'
import { loadDecoderWasmModules, createTestPng } from '../testSupport/wasmTestFixtures'
import { encodeTestPng } from '../testSupport/rasterEncode'
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

// Task 4's five comparison categories, mapped to the synthetic images built
// for them (see testSupport/qualityTestImages.ts) and — where one exists —
// the matching named ImageTracer profile for a fair, equally-tuned
// comparison rather than ImageTracer's generic auto-recommendation.
const COMPARISON_CASES: { label: string; imageId: string; imageTracerPreset: string | null }[] = [
  { label: 'Logo', imageId: 'monochrome-logo', imageTracerPreset: 'logo' },
  { label: 'QR', imageId: 'qr-code', imageTracerPreset: 'qrCode' },
  { label: 'Signature', imageId: 'signature', imageTracerPreset: 'signature' },
  { label: 'Stamp', imageId: 'stamp', imageTracerPreset: null }, // no dedicated ImageTracer profile — this is the point
  { label: 'Icon', imageId: 'icon', imageTracerPreset: 'icon' },
]

interface ComparisonRow {
  label: string
  potrace: SvgQualityMetrics
  potraceTimeMs: number
  imageTracer: SvgQualityMetrics
  imageTracerTimeMs: number
  winner: 'potrace' | 'imagetracer'
}

function formatRow(row: ComparisonRow): string {
  const p = row.potrace
  const it = row.imageTracer
  return (
    `${row.label.padEnd(11)} ` +
    `potrace: ${String(p.svgSizeBytes).padStart(6)}B ${String(p.pathCount).padStart(3)}paths ${String(p.nodeCount).padStart(5)}nodes ${row.potraceTimeMs.toFixed(1).padStart(6)}ms | ` +
    `imagetracer: ${String(it.svgSizeBytes).padStart(6)}B ${String(it.pathCount).padStart(3)}paths ${String(it.nodeCount).padStart(5)}nodes ${row.imageTracerTimeMs.toFixed(1).padStart(6)}ms | ` +
    `winner=${row.winner}`
  )
}

async function run() {
  const wasm = await loadDecoderWasmModules()
  const potrace = new PotraceProvider(wasm)
  const imageTracer = new PlaceholderProvider(wasm)
  const images = buildQualityTestImages()
  const byId = new Map(images.map((image) => [image.id, image]))

  function getImage(id: string): QualityTestImage {
    const image = byId.get(id)
    if (!image) throw new Error(`No synthetic test image with id "${id}"`)
    return image
  }

  // 1. Basic correctness: PotraceProvider produces a real, non-empty SVG.
  const pngBytes = await createTestPng()
  const pngUpload = makeUpload({ mimeType: 'image/png' })
  const start = performance.now()
  const result = await potrace.vectorize(pngUpload, pngBytes)
  const elapsed = performance.now() - start
  const svg = new TextDecoder().decode(result.data)
  assertEqual(result.format, 'svg', 'PotraceProvider.vectorize produces svg format')
  assertTrue(svg.startsWith('<svg'), 'PotraceProvider.vectorize produces a real SVG document')
  assertTrue(measureSvgQuality(svg).nodeCount > 0, 'PotraceProvider.vectorize traces at least one node')
  console.log(`PASS: PotraceProvider.vectorize produces a real, non-empty traced SVG (${elapsed.toFixed(1)}ms)`)

  // 2. Normalized dimensions — same contract as PlaceholderProvider (see
  // svgOptimizer.optimizeSvg), regardless of which engine's output won.
  assertTrue(/viewBox="0 0 8 8"/.test(svg), 'output viewBox matches the 8x8 source image')
  assertTrue(/width="8" height="8"/.test(svg), 'output width/height match the 8x8 source image')
  console.log('PASS: output SVG dimensions are normalized to the real decoded image size')

  // 3. Invalid/corrupted input handled the same way as PlaceholderProvider
  // (both go through the same shared decodeImage — see imageDecoder.ts).
  await assertRejects(
    () => potrace.vectorize(makeUpload({ mimeType: 'image/gif' }), pngBytes),
    /Cannot vectorize unsupported mime type/,
    'invalid image mime type',
  )
  console.log('PASS: an unsupported mime type is rejected with a clear error')

  const corruptedPng = pngBytes.slice(0, 20)
  await assertRejects(
    () => potrace.vectorize(makeUpload({ mimeType: 'image/png' }), corruptedPng),
    /Failed to decode image\/png image/,
    'corrupted PNG',
  )
  console.log('PASS: a corrupted (truncated) image is rejected with a clear error, not a crash/hang')

  // 4. The actual task requirement: compare Potrace vs ImageTracer on Logo/
  // QR/Signature/Stamp/Icon, and confirm vectorize() automatically returns
  // whichever measured better — not just "whatever Potrace produced".
  console.log('\nPotrace vs ImageTracer comparison:')
  const rows: ComparisonRow[] = []
  for (const testCase of COMPARISON_CASES) {
    const image = getImage(testCase.imageId)
    const bytes = await encodeTestPng(image.imageData)
    const upload = makeUpload({ mimeType: 'image/png', originalFileName: `${image.id}.png` })

    const potraceStart = performance.now()
    const potraceResult = await potrace.traceOnly(upload, bytes)
    const potraceTimeMs = performance.now() - potraceStart
    const potraceMetrics = measureSvgQuality(new TextDecoder().decode(potraceResult.data))

    const preset = testCase.imageTracerPreset && isTracePresetName(testCase.imageTracerPreset) ? testCase.imageTracerPreset : null
    const imageTracerStart = performance.now()
    const imageTracerResult = await imageTracer.vectorize(upload, bytes, preset)
    const imageTracerTimeMs = performance.now() - imageTracerStart
    const imageTracerMetrics = measureSvgQuality(new TextDecoder().decode(imageTracerResult.data))

    assertTrue(potraceMetrics.nodeCount > 0, `${testCase.label}: Potrace produces real output`)
    assertTrue(imageTracerMetrics.nodeCount > 0, `${testCase.label}: ImageTracer produces real output`)

    const winner: ComparisonRow['winner'] =
      potraceMetrics.nodeCount !== imageTracerMetrics.nodeCount
        ? potraceMetrics.nodeCount < imageTracerMetrics.nodeCount
          ? 'potrace'
          : 'imagetracer'
        : potraceMetrics.svgSizeBytes <= imageTracerMetrics.svgSizeBytes
          ? 'potrace'
          : 'imagetracer'

    const row: ComparisonRow = { label: testCase.label, potrace: potraceMetrics, potraceTimeMs, imageTracer: imageTracerMetrics, imageTracerTimeMs, winner }
    rows.push(row)
    console.log(formatRow(row))

    // The actual production method (vectorize, not traceOnly) must return
    // the winner — this is task requirement 5 ("automatically keep the
    // better result"), verified per-category, not just asserted in the
    // abstract.
    const productionResult = await potrace.vectorize(upload, bytes, preset)
    const productionMetrics = measureSvgQuality(new TextDecoder().decode(productionResult.data))
    const expectedMetrics = winner === 'potrace' ? potraceMetrics : imageTracerMetrics
    assertEqual(productionMetrics.nodeCount, expectedMetrics.nodeCount, `${testCase.label}: vectorize() automatically keeps the objectively better (fewer-node) result`)
  }

  const potraceWins = rows.filter((r) => r.winner === 'potrace').length
  console.log(`\n${potraceWins}/${rows.length} categories won by Potrace (by node count, tie-broken by size).`)

  // Task 2's explicit target content: Potrace should win comfortably on at
  // least the QR/Stamp cases — dense binary-threshold content ImageTracer's
  // color-quantization pipeline isn't built for.
  const qrRow = rows.find((r) => r.label === 'QR')
  const stampRow = rows.find((r) => r.label === 'Stamp')
  assertTrue(qrRow?.winner === 'potrace', 'Potrace wins on QR (dense binary grid)')
  assertTrue(stampRow?.winner === 'potrace', 'Potrace wins on Stamp (worn ink texture ImageTracer has no dedicated profile for)')
  console.log('PASS: Potrace measurably wins the categories it was built for (QR, Stamp)')

  console.log('\nAll PotraceProvider smoke tests passed.')
}

run().catch((error: unknown) => {
  console.error('Smoke test failed:', error)
  throw error
})
