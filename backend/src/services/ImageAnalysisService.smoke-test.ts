// Local smoke test for ImageAnalysisService (Phase 21) — encodes synthetic
// pixel data to real PNG bytes (same jSquash encoder/decoder pair the real
// pipeline uses), runs the full decode -> analyze -> classify -> select
// pipeline, and checks the classification/selection lands where the
// generator's shape says it should. Mirrors providers/imageAnalysis.smoke-test.ts's
// synthetic-image style, one level up the stack.
//
// Run with: npx tsx src/services/ImageAnalysisService.smoke-test.ts (from inside backend/)
import { createImageAnalysisService } from './ImageAnalysisService'
import { loadDecoderWasmModules } from '../testSupport/wasmTestFixtures'
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

// Flat grayscale bands — few colors, low edge density, no transparency, and
// (unlike providers/imageAnalysis.smoke-test.ts's makeLogoLike) every band is
// a shade of gray, not a hue — should trip isGrayscale.
function makeGrayscaleLogoLike(): ImageData {
  const shades = [20, 60, 100, 140, 180, 220]
  return makeImageData(40, 40, (x) => {
    const shade = shades[Math.min(shades.length - 1, Math.floor((x / 40) * shades.length))] ?? 0
    return [shade, shade, shade, 255]
  })
}

// Several flat hues, no transparency — colored, not grayscale.
function makeColoredLogoLike(): ImageData {
  const bandColors: [number, number, number][] = [
    [200, 30, 30], [30, 200, 30], [30, 30, 200], [200, 200, 30], [200, 30, 200],
    [30, 200, 200], [120, 60, 20], [20, 120, 60], [60, 20, 120], [90, 90, 90],
  ]
  return makeImageData(40, 40, (x) => {
    const band = bandColors[Math.min(bandColors.length - 1, Math.floor((x / 40) * bandColors.length))]
    const [r, g, b] = band ?? [0, 0, 0]
    return [r, g, b, 255]
  })
}

// A smooth, fine-grained hue gradient — many distinct colors, low edge density.
function makeIllustrationLike(): ImageData {
  return makeImageData(64, 64, (x) => {
    const hue = (x / 64) * 300
    const c = 200
    const hPrime = hue / 60
    const xComponent = c * (1 - Math.abs((hPrime % 2) - 1))
    let [r, g, b] = [0, 0, 0]
    if (hPrime < 1) [r, g, b] = [c, xComponent, 0]
    else if (hPrime < 2) [r, g, b] = [xComponent, c, 0]
    else if (hPrime < 3) [r, g, b] = [0, c, xComponent]
    else if (hPrime < 4) [r, g, b] = [0, xComponent, c]
    else [r, g, b] = [xComponent, 0, c]
    return [Math.round(r + 30), Math.round(g + 30), Math.round(b + 30), 255]
  })
}

// Random noise — high color variety AND high edge density -> 'photo'.
function makePhotoLike(): ImageData {
  return makeImageData(48, 48, () => [
    Math.floor(Math.random() * 256),
    Math.floor(Math.random() * 256),
    Math.floor(Math.random() * 256),
    255,
  ])
}

function makeUpload(overrides: Partial<Upload> = {}): Upload {
  return {
    id: 'upload-1',
    userId: 'user-1',
    originalFileName: 'test.png',
    mimeType: 'image/png',
    sizeBytes: 0,
    storageKey: 'uploads/user-1/upload-1/test.png',
    status: 'stored',
    createdAt: new Date().toISOString(),
    ...overrides,
  }
}

async function run() {
  const wasm = await loadDecoderWasmModules()
  const service = createImageAnalysisService(wasm)
  const upload = makeUpload()

  // 1. Monochrome logo -> imageType 'logo', isGrayscale true, recommendedProvider 'potrace'
  const grayscaleBytes = await encodeTestPng(makeGrayscaleLogoLike())
  const grayscaleResult = await service.analyze(upload, grayscaleBytes)
  assertEqual(grayscaleResult.imageType, 'logo', 'grayscale bands classify as logo')
  assertEqual(grayscaleResult.isGrayscale, true, 'grayscale bands are detected as grayscale')
  assertEqual(grayscaleResult.recommendedProvider, 'potrace', 'monochrome logo recommends potrace')
  assertEqual(grayscaleResult.hasTransparency, false, 'opaque image has no transparency')
  console.log(
    `PASS: monochrome logo -> logo/grayscale/potrace (colors=${grayscaleResult.colorCountEstimate}, quality=${grayscaleResult.estimatedQuality})`,
  )

  // 2. Colored logo -> imageType 'logo', isGrayscale false, recommendedProvider 'placeholder'
  const coloredBytes = await encodeTestPng(makeColoredLogoLike())
  const coloredResult = await service.analyze(upload, coloredBytes)
  assertEqual(coloredResult.imageType, 'logo', 'colored bands classify as logo')
  assertEqual(coloredResult.isGrayscale, false, 'colored bands are not grayscale')
  assertEqual(coloredResult.recommendedProvider, 'placeholder', 'colored logo recommends placeholder (ImageTracer)')
  assertTrue(coloredResult.dominantColors.length > 0, 'dominantColors is non-empty')
  console.log(`PASS: colored logo -> logo/colored/placeholder (dominantColors=${coloredResult.dominantColors.join(', ')})`)

  // 3. Illustration -> imageType 'illustration', recommendedProvider 'placeholder'
  const illustrationBytes = await encodeTestPng(makeIllustrationLike())
  const illustrationResult = await service.analyze(upload, illustrationBytes)
  assertEqual(illustrationResult.imageType, 'illustration', 'many-hued gradient classifies as illustration')
  assertEqual(illustrationResult.recommendedProvider, 'placeholder', 'illustration recommends placeholder (ImageTracer)')
  console.log(`PASS: illustration -> illustration/placeholder (colors=${illustrationResult.colorCountEstimate})`)

  // 4. Photograph -> imageType 'photo', recommendedProvider 'vision', a real credit/time estimate
  const photoBytes = await encodeTestPng(makePhotoLike())
  const photoResult = await service.analyze(upload, photoBytes)
  assertEqual(photoResult.imageType, 'photo', 'random noise classifies as photo')
  assertEqual(photoResult.recommendedProvider, 'vision', 'photograph recommends vision (professional AI, future)')
  assertTrue(photoResult.estimatedCredits > 0, 'estimatedCredits is positive')
  assertTrue(photoResult.estimatedProcessingTimeMs > 0, 'estimatedProcessingTimeMs is positive')
  assertTrue(photoResult.noiseLevel > grayscaleResult.noiseLevel, 'random noise has a higher noiseLevel than flat bands')
  console.log(
    `PASS: photograph -> photo/vision (quality=${photoResult.estimatedQuality}, credits=${photoResult.estimatedCredits}, ` +
      `timeMs=${photoResult.estimatedProcessingTimeMs}, noise=${photoResult.noiseLevel.toFixed(2)})`,
  )

  // 5. Dimensions/aspect ratio reported correctly for a non-square image.
  const wideBytes = await encodeTestPng(makeImageData(64, 32, () => [10, 10, 10, 255]))
  const wideResult = await service.analyze(upload, wideBytes)
  assertEqual(wideResult.width, 64, 'width matches the source image')
  assertEqual(wideResult.height, 32, 'height matches the source image')
  assertEqual(wideResult.aspectRatio, 2, 'aspectRatio is width/height')
  console.log('PASS: width/height/aspectRatio reported correctly for a non-square image')

  console.log('\nAll ImageAnalysisService smoke tests passed.')
}

run().catch((error: unknown) => {
  console.error('Smoke test failed:', error)
  throw error
})
