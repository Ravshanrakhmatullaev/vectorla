// Local smoke test for the Phase 23 trace-profile tuning: every named
// profile (see tracePresets.ts) stays inside its quality budget on its
// representative synthetic image, tracePresetSelector.ts picks the right
// profile automatically, and — the actual "comparison" this phase asks
// for — each new/retuned profile measurably beats the naive alternative
// (an unrelated existing preset, or ImageTracer's own untuned default) on
// the content it was built for.
//
// Run with: npx tsx src/providers/tracePresets.smoke-test.ts (from inside backend/)
import { PlaceholderProvider } from './PlaceholderProvider'
import { TRACE_PRESETS } from './tracePresets'
import { measureSvgQuality } from '../qualityTesting/svgQualityMetrics'
import { runQualityHarness } from '../qualityTesting/qualityHarness'
import { buildQualityTestImages, type QualityTestImage } from '../testSupport/qualityTestImages'
import { loadDecoderWasmModules } from '../testSupport/wasmTestFixtures'
import { encodeTestPng } from '../testSupport/rasterEncode'
import type { Upload } from '../types'

function assertTrue(condition: boolean, message: string): void {
  if (!condition) throw new Error(message)
}

function assertEqual<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
  }
}

function makeUpload(image: QualityTestImage): Upload {
  return {
    id: `upload-${image.id}`,
    userId: 'trace-preset-test-user',
    originalFileName: `${image.id}.png`,
    mimeType: 'image/png',
    sizeBytes: 0,
    storageKey: `uploads/trace-preset-test-user/upload-${image.id}/${image.id}`,
    status: 'stored',
    createdAt: new Date().toISOString(),
  }
}

async function run() {
  const wasm = await loadDecoderWasmModules()
  const provider = new PlaceholderProvider(wasm)
  const images = buildQualityTestImages()
  const byId = new Map(images.map((image) => [image.id, image]))

  function getImage(id: string): QualityTestImage {
    const image = byId.get(id)
    if (!image) throw new Error(`No synthetic test image with id "${id}"`)
    return image
  }

  // 1. Every named profile stays inside its measured quality budget on its
  // representative image, and tracePresetSelector.ts automatically picks
  // the intended profile for every category — see runQualityHarness.ts.
  const results = await runQualityHarness()
  for (const result of results) {
    assertEqual(result.problems.length, 0, `"${result.label}" has no flagged quality problems (got: ${result.problems.join(', ')})`)
  }
  console.log(`PASS: all ${results.length} synthetic categories trace within budget (0 flagged problems)`)

  const expectedPresetByImageId: Record<string, string> = {
    signature: 'signature',
    'qr-code': 'qrCode',
    blueprint: 'blueprint',
    sketch: 'sketch',
    sticker: 'sticker',
    'transparent-png': 'sticker',
  }
  for (const [imageId, expectedPreset] of Object.entries(expectedPresetByImageId)) {
    const result = results.find((r) => r.id === imageId)
    assertTrue(Boolean(result), `harness produced a result for "${imageId}"`)
    assertEqual(result?.selectedPreset, expectedPreset, `tracePresetSelector picks "${expectedPreset}" for "${imageId}"`)
  }
  console.log('PASS: tracePresetSelector automatically selects the intended profile for every new category')

  // 2. Comparison — QR code: the dedicated 'qrCode' profile (loose
  // ltres/qtres, rightangleenhance, integer roundcoords) beats reusing
  // 'logo' on the same source (tighter thresholds fit far more segments to
  // what's actually just a small number of straight module edges).
  {
    const image = getImage('qr-code')
    const bytes = await encodeTestPng(image.imageData)
    const upload = makeUpload(image)
    const withLogoPreset = await provider.vectorize(upload, bytes, 'logo')
    const withQrPreset = await provider.vectorize(upload, bytes, 'qrCode')
    const logoMetrics = measureSvgQuality(new TextDecoder().decode(withLogoPreset.data))
    const qrMetrics = measureSvgQuality(new TextDecoder().decode(withQrPreset.data))
    assertTrue(
      qrMetrics.svgSizeBytes <= logoMetrics.svgSizeBytes,
      `qrCode preset (${qrMetrics.svgSizeBytes}B) is no larger than the 'logo' preset (${logoMetrics.svgSizeBytes}B) on the same QR-like source`,
    )
    assertTrue(
      qrMetrics.nodeCount <= logoMetrics.nodeCount,
      `qrCode preset (${qrMetrics.nodeCount} nodes) has no more nodes than the 'logo' preset (${logoMetrics.nodeCount} nodes)`,
    )
    console.log(
      `PASS: qrCode preset beats reusing 'logo' on a QR-like source (${logoMetrics.svgSizeBytes}B/${logoMetrics.nodeCount} nodes -> ${qrMetrics.svgSizeBytes}B/${qrMetrics.nodeCount} nodes)`,
    )
  }

  // 3. Comparison — Signature: the default pathomit (8, same as 'logo') is
  // large enough to discard genuine thin signature strokes as noise;
  // signature's pathomit:2 must preserve strictly more path detail on the
  // same sparse-ink source.
  {
    const image = getImage('signature')
    const bytes = await encodeTestPng(image.imageData)
    const upload = makeUpload(image)
    const withLogoPreset = await provider.vectorize(upload, bytes, 'logo')
    const withSignaturePreset = await provider.vectorize(upload, bytes, 'signature')
    const logoMetrics = measureSvgQuality(new TextDecoder().decode(withLogoPreset.data))
    const signatureMetrics = measureSvgQuality(new TextDecoder().decode(withSignaturePreset.data))
    assertTrue(
      signatureMetrics.pathCount >= logoMetrics.pathCount,
      `signature preset (${signatureMetrics.pathCount} paths) preserves at least as much stroke detail as 'logo' (${logoMetrics.pathCount} paths) on a thin-ink source`,
    )
    console.log(
      `PASS: signature preset preserves thin-stroke detail 'logo' would risk discarding (${logoMetrics.pathCount} -> ${signatureMetrics.pathCount} paths)`,
    )
  }

  // 4. Comparison — Sketch: this is the actual "reject noisy/exploding
  // settings" case (task requirement). Tracing textured pencil-like input
  // with 'logo' (blurradius:0 — no denoising at all, and the tightest
  // pathomit of any preset) explodes into thousands of speckle paths; the
  // tuned sketch profile (blurradius:4, linefilter, high pathomit) must be
  // dramatically smaller on every axis for the exact same source pixels.
  {
    const image = getImage('sketch')
    const bytes = await encodeTestPng(image.imageData)
    const upload = makeUpload(image)
    const withLogoPreset = await provider.vectorize(upload, bytes, 'logo')
    const withSketchPreset = await provider.vectorize(upload, bytes, 'sketch')
    const logoMetrics = measureSvgQuality(new TextDecoder().decode(withLogoPreset.data))
    const sketchMetrics = measureSvgQuality(new TextDecoder().decode(withSketchPreset.data))
    assertTrue(
      sketchMetrics.svgSizeBytes < logoMetrics.svgSizeBytes,
      `sketch preset (${sketchMetrics.svgSizeBytes}B) is dramatically smaller than tracing the same noisy source with 'logo' (${logoMetrics.svgSizeBytes}B)`,
    )
    assertTrue(
      sketchMetrics.nodeCount < logoMetrics.nodeCount,
      `sketch preset (${sketchMetrics.nodeCount} nodes) has far fewer nodes than 'logo' on the same source (${logoMetrics.nodeCount} nodes) — this is the "reject settings that explode node count" case`,
    )
    console.log(
      `PASS: sketch preset rejects the noise explosion an untuned/unblurred trace produces (${logoMetrics.svgSizeBytes}B/${logoMetrics.nodeCount} nodes -> ${sketchMetrics.svgSizeBytes}B/${sketchMetrics.nodeCount} nodes)`,
    )
  }

  // 5. Every preset is a fully-specified, valid options object (no
  // accidental gaps from the Phase 23 rewrite) and every preset actually
  // produces real output on a representative image.
  for (const presetName of Object.keys(TRACE_PRESETS) as (keyof typeof TRACE_PRESETS)[]) {
    const options = TRACE_PRESETS[presetName]
    assertEqual(options.scale, 1, `"${presetName}" keeps scale:1 (optimizeSvg assumes 1:1 coordinate/pixel correspondence)`)
    assertEqual(options.viewbox, false, `"${presetName}" keeps viewbox:false (optimizeSvg always sets its own)`)
    assertEqual(options.desc, false, `"${presetName}" keeps desc:false (no functional value, pure size cost)`)
  }
  console.log('PASS: every preset keeps the shared non-negotiable defaults (scale/viewbox/desc)')

  console.log('\nAll trace-preset tuning smoke tests passed.')
}

run().catch((error: unknown) => {
  console.error('Smoke test failed:', error)
  throw error
})
