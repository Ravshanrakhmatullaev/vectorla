// Local smoke test for the Professional Trace preprocessing pipeline (Phase
// 25) — each of the 6 image-domain stages tested independently ("Create
// independent preprocessing stages" — task requirement 1), the orchestrator
// wired end-to-end, per-stage timing measured, and the Professional-vs-Quick
// bypass behavior (task requirement 4) verified directly.
//
// Run with: npx tsx src/pipeline/ProfessionalTracePipeline.smoke-test.ts (from inside backend/)
import { AutoUpscaleStage } from './stages/AutoUpscaleStage'
import { NoiseReductionStage } from './stages/NoiseReductionStage'
import { BackgroundCleanupStage } from './stages/BackgroundCleanupStage'
import { ContrastNormalizationStage } from './stages/ContrastNormalizationStage'
import { ColorQuantizationStage } from './stages/ColorQuantizationStage'
import { EdgeEnhancementStage } from './stages/EdgeEnhancementStage'
import { runTracePipeline, runProfessionalTrace, runQuickTrace, DEFAULT_PIPELINE_CONFIG } from './ProfessionalTracePipeline'

function assertEqual<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
  }
}

function assertTrue(condition: boolean, message: string): void {
  if (!condition) throw new Error(message)
}

function makeImageData(width: number, height: number, fill: (x: number, y: number) => [number, number, number, number]): ImageData {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4
      const [r, g, b, a] = fill(x, y)
      data[i] = r
      data[i + 1] = g
      data[i + 2] = b
      data[i + 3] = a
    }
  }
  return { width, height, data } as ImageData
}

// A flat logo-like mark with a bit of salt-and-pepper noise sprinkled in —
// exercises noise reduction and edge enhancement meaningfully.
function makeNoisyMark(): ImageData {
  const size = 64
  let seed = 7
  const rng = () => {
    seed = (seed * 48271) % 2147483647
    return seed / 2147483647
  }
  return makeImageData(size, size, (x, y) => {
    const inSquare = x >= 20 && x < 44 && y >= 20 && y < 44
    const [r, g, b] = inSquare ? [30, 60, 200] : [250, 250, 250]
    const noisy = rng() < 0.05
    return noisy ? [rng() * 255, rng() * 255, rng() * 255, 255] : [r, g, b, 255]
  })
}

// Washed-out (low-contrast, all mid-gray-ish) version of a hard-edged mark
// — luma never approaches 0 or 255, so ContrastNormalizationStage has
// something real to stretch.
function makeLowContrastMark(): ImageData {
  const size = 40
  return makeImageData(size, size, (x, y) => {
    const inSquare = x >= 12 && x < 28 && y >= 12 && y < 28
    return inSquare ? [100, 100, 130, 255] : [160, 160, 150, 255]
  })
}

function countDistinctColors(imageData: ImageData): number {
  const seen = new Set<number>()
  const { width, height, data } = imageData
  for (let i = 0; i < width * height; i++) {
    const idx = i * 4
    seen.add(((data[idx] ?? 0) << 16) | ((data[idx + 1] ?? 0) << 8) | (data[idx + 2] ?? 0))
  }
  return seen.size
}

// Blurring random speckle noise doesn't reduce the *count* of distinct
// colors (averaging creates new in-between values near every transition) —
// it reduces how far pixel values swing from their local neighborhood, i.e.
// variance. That's the real, measurable signature of denoising.
function channelVariance(imageData: ImageData, channel: number): number {
  const { width, height, data } = imageData
  const count = width * height
  let sum = 0
  let sumSquares = 0
  for (let i = 0; i < count; i++) {
    const value = data[i * 4 + channel] ?? 0
    sum += value
    sumSquares += value * value
  }
  const mean = sum / count
  return sumSquares / count - mean * mean
}

async function run() {
  // 1. AutoUpscaleStage — documented no-op hook, must be a pure identity.
  const mark = makeNoisyMark()
  const upscale = new AutoUpscaleStage()
  const upscaled = upscale.process(mark)
  assertEqual(upscaled, mark, 'AutoUpscaleStage is a pure passthrough (future hook, no real upscaling yet)')
  console.log('PASS: AutoUpscaleStage passes ImageData through unchanged')

  // 2. NoiseReductionStage — measurably reduces variance (real denoising, not just "fewer colors" — see channelVariance's doc comment).
  const noiseReduction = new NoiseReductionStage()
  const denoised = noiseReduction.process(mark)
  assertEqual(denoised.width, mark.width, 'NoiseReductionStage preserves width')
  assertEqual(denoised.height, mark.height, 'NoiseReductionStage preserves height')
  const varianceBefore = channelVariance(mark, 0)
  const varianceAfter = channelVariance(denoised, 0)
  assertTrue(varianceAfter < varianceBefore, 'NoiseReductionStage reduces red-channel variance (real denoising)')
  console.log(`PASS: NoiseReductionStage smooths noise (variance ${varianceBefore.toFixed(1)} -> ${varianceAfter.toFixed(1)})`)

  // 3. BackgroundCleanupStage — a near-background pixel gets snapped flat to the estimated background color.
  const backgroundCleanup = new BackgroundCleanupStage()
  const nearBackground = makeImageData(20, 20, (x, y) => (x === 10 && y === 10 ? [248, 248, 248, 255] : [255, 255, 255, 255]))
  const cleaned = backgroundCleanup.process(nearBackground)
  const centerIdx = (10 * 20 + 10) * 4
  assertEqual(cleaned.data[centerIdx], 255, 'BackgroundCleanupStage snaps a near-background pixel flat to the estimated background color')
  console.log('PASS: BackgroundCleanupStage flattens near-background pixels')

  // 4. ContrastNormalizationStage — stretches a washed-out range to fill 0-255.
  const contrastStage = new ContrastNormalizationStage()
  const lowContrast = makeLowContrastMark()
  const normalized = contrastStage.process(lowContrast)
  let minAfter = 255
  let maxAfter = 0
  for (let i = 0; i < normalized.data.length; i += 4) {
    const v = normalized.data[i] ?? 0
    if (v < minAfter) minAfter = v
    if (v > maxAfter) maxAfter = v
  }
  assertTrue(minAfter <= 5, `ContrastNormalizationStage stretches the dark end toward 0 (got ${minAfter})`)
  assertTrue(maxAfter >= 250, `ContrastNormalizationStage stretches the light end toward 255 (got ${maxAfter})`)
  console.log(`PASS: ContrastNormalizationStage stretches a low-contrast source to fill the range (${minAfter}-${maxAfter})`)

  // A flat image has nothing to stretch — must return unchanged, not divide by zero.
  const flat = makeImageData(10, 10, () => [128, 128, 128, 255])
  const flatResult = contrastStage.process(flat)
  assertEqual(flatResult, flat, 'ContrastNormalizationStage no-ops on an already-flat image instead of dividing by zero')
  console.log('PASS: ContrastNormalizationStage safely no-ops on a flat (zero-range) image')

  // 5. ColorQuantizationStage — reduces distinct-color count on a gradient.
  const quantization = new ColorQuantizationStage()
  const gradient = makeImageData(32, 1, (x) => [x * 8, x * 8, x * 8, 255])
  const quantized = quantization.process(gradient)
  assertTrue(countDistinctColors(quantized) < countDistinctColors(gradient), 'ColorQuantizationStage reduces distinct-color count on a gradient')
  console.log(`PASS: ColorQuantizationStage reduces color count (${countDistinctColors(gradient)} -> ${countDistinctColors(quantized)})`)

  // 6. EdgeEnhancementStage — produces real output, preserves dimensions/alpha, differs from input on an edge-containing image.
  const edgeStage = new EdgeEnhancementStage()
  const sharpened = edgeStage.process(mark)
  assertEqual(sharpened.width, mark.width, 'EdgeEnhancementStage preserves width')
  const alphaIdx = 3
  assertEqual(sharpened.data[alphaIdx], mark.data[alphaIdx], 'EdgeEnhancementStage leaves alpha untouched')
  assertTrue(sharpened.data.some((value, i) => i % 4 !== 3 && value !== mark.data[i]), 'EdgeEnhancementStage changes at least one RGB value on an edge-containing image')
  console.log('PASS: EdgeEnhancementStage sharpens edges without touching alpha')

  // 7. Orchestrator: Professional Trace runs all default-enabled preprocessing stages + selection + optimization.
  const professional = await runProfessionalTrace(mark)
  assertTrue(professional.svg.startsWith('<svg'), 'runProfessionalTrace produces a real SVG document')
  assertEqual(professional.stageTimings.length, 8, 'runProfessionalTrace measures all 8 pipeline stages')
  const preprocessingNames = ['auto-upscale', 'noise-reduction', 'background-cleanup', 'contrast-normalization', 'color-quantization', 'edge-enhancement']
  for (const name of preprocessingNames) {
    const timing = professional.stageTimings.find((t) => t.name === name)
    assertTrue(Boolean(timing), `stage timing recorded for "${name}"`)
    const shouldBeEnabled = DEFAULT_PIPELINE_CONFIG[name.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase()) as keyof typeof DEFAULT_PIPELINE_CONFIG]
    assertEqual(timing?.enabled, shouldBeEnabled, `"${name}" enabled flag matches DEFAULT_PIPELINE_CONFIG`)
  }
  assertTrue(professional.totalTimeMs >= 0, 'runProfessionalTrace reports a non-negative total time')
  console.log(`PASS: runProfessionalTrace runs the full pipeline (${professional.stageTimings.length} stages, ${professional.totalTimeMs.toFixed(2)}ms total, provider=${professional.provider}, preset=${professional.tracePreset})`)

  // 8. Orchestrator: Quick Trace bypasses every preprocessing stage — task requirement 4.
  const quick = await runQuickTrace(mark)
  assertTrue(quick.svg.startsWith('<svg'), 'runQuickTrace produces a real SVG document')
  for (const name of preprocessingNames) {
    const timing = quick.stageTimings.find((t) => t.name === name)
    assertEqual(timing?.enabled, false, `Quick Trace disables "${name}"`)
  }
  const selectionTiming = quick.stageTimings.find((t) => t.name === 'provider-selection')
  const optimizationTiming = quick.stageTimings.find((t) => t.name === 'svg-optimization')
  assertEqual(selectionTiming?.enabled, true, 'Quick Trace still runs provider selection')
  assertEqual(optimizationTiming?.enabled, true, 'Quick Trace still runs SVG optimization')
  console.log('PASS: runQuickTrace bypasses every preprocessing stage but still selects a provider and optimizes the SVG')

  // 9. Individual enable/disable (task requirement 3): disabling exactly one
  // stage leaves every other stage's enabled flag untouched.
  const partial = await runTracePipeline(mark, { noiseReduction: false })
  const noiseTiming = partial.stageTimings.find((t) => t.name === 'noise-reduction')
  const backgroundTiming = partial.stageTimings.find((t) => t.name === 'background-cleanup')
  assertEqual(noiseTiming?.enabled, false, 'disabling noiseReduction only affects that stage')
  assertEqual(backgroundTiming?.enabled, true, 'other stages stay enabled when only one is disabled')
  console.log('PASS: individual stages can be enabled/disabled independently of one another')

  // 10. Stage instances are stateless per call — running twice with
  // different configs back-to-back must not leak state between runs (no
  // shared mutable singletons — see ProfessionalTracePipeline.ts's doc comment).
  const first = await runTracePipeline(mark, { colorQuantization: false })
  const second = await runTracePipeline(mark, { colorQuantization: true })
  const firstQuantTiming = first.stageTimings.find((t) => t.name === 'color-quantization')
  const secondQuantTiming = second.stageTimings.find((t) => t.name === 'color-quantization')
  assertEqual(firstQuantTiming?.enabled, false, 'first run: color-quantization disabled as configured')
  assertEqual(secondQuantTiming?.enabled, true, 'second run: color-quantization enabled as configured, unaffected by the previous run')
  console.log('PASS: consecutive pipeline runs with different configs do not leak state into one another')

  console.log('\nAll Professional Trace pipeline smoke tests passed.')
}

run().catch((error: unknown) => {
  console.error('Smoke test failed:', error)
  throw error
})
