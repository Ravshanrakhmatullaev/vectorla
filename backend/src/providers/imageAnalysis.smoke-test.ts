// Local smoke test for analyzeImage (Phase 20) — exercises color/transparency/
// complexity estimation and preset recommendation directly against
// constructed pixel data, no WASM/decode needed (that's covered end-to-end
// in PlaceholderProvider.smoke-test.ts).
//
// Run with: npx tsx src/providers/imageAnalysis.smoke-test.ts (from inside backend/)
import { analyzeImage } from './imageAnalysis'

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

// Two flat colors, no transparency, a small colored square on a large plain
// background — very few edges when sampled.
function makeIconLike(): ImageData {
  return makeImageData(32, 32, (x, y) => {
    const inSquare = x >= 12 && x < 20 && y >= 12 && y < 20
    return inSquare ? [20, 20, 20, 255] : [250, 250, 250, 255]
  })
}

// Ten flat color bands, no transparency — more colors than an icon, but
// still low edge density (each band is wide).
function makeLogoLike(): ImageData {
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

// Same flat-band layout as "logo", but with a transparent border — should
// tip the recommendation toward "sticker" instead.
function makeStickerLike(): ImageData {
  const bandColors: [number, number, number][] = [
    [200, 30, 30], [30, 200, 30], [30, 30, 200], [200, 200, 30], [200, 30, 200],
  ]
  return makeImageData(40, 40, (x, y) => {
    const isBorder = x < 3 || x >= 37 || y < 3 || y >= 37
    const band = bandColors[Math.min(bandColors.length - 1, Math.floor((x / 40) * bandColors.length))]
    const [r, g, b] = band ?? [0, 0, 0]
    return [r, g, b, isBorder ? 0 : 255]
  })
}

// A smooth, fine-grained hue gradient — many distinct quantized colors, but
// adjacent pixels barely differ, so edge density stays low.
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

// Random noise — high color variety AND high edge density.
function makePhotoLike(): ImageData {
  return makeImageData(48, 48, () => {
    return [Math.floor(Math.random() * 256), Math.floor(Math.random() * 256), Math.floor(Math.random() * 256), 255]
  })
}

async function run() {
  // 1. Icon-like: very few colors, no transparency, low complexity
  const icon = analyzeImage(makeIconLike())
  assertTrue(icon.colorCountEstimate <= 6, `icon-like image has few colors (got ${icon.colorCountEstimate})`)
  assertEqual(icon.hasTransparency, false, 'icon-like image has no transparency')
  assertEqual(icon.recommendedPreset, 'icon', 'icon-like image recommends the icon preset')
  console.log(`PASS: icon-like image (colors=${icon.colorCountEstimate}, complexity=${icon.complexityScore.toFixed(2)}) -> icon`)

  // 2. Logo-like: several flat colors, no transparency, low-moderate complexity
  const logo = analyzeImage(makeLogoLike())
  assertEqual(logo.hasTransparency, false, 'logo-like image has no transparency')
  assertEqual(logo.recommendedPreset, 'logo', 'logo-like image recommends the logo preset (the default fallback)')
  console.log(`PASS: logo-like image (colors=${logo.colorCountEstimate}, complexity=${logo.complexityScore.toFixed(2)}) -> logo`)

  // 3. Sticker-like: same shape as logo, but with real transparency
  const sticker = analyzeImage(makeStickerLike())
  assertEqual(sticker.hasTransparency, true, 'sticker-like image has transparency')
  assertEqual(sticker.recommendedPreset, 'sticker', 'sticker-like image (flat colors + transparency) recommends sticker')
  console.log(`PASS: sticker-like image (colors=${sticker.colorCountEstimate}, transparent) -> sticker`)

  // 4. Illustration-like: many distinct colors, low edge density
  const illustration = analyzeImage(makeIllustrationLike())
  assertTrue(illustration.colorCountEstimate > 32, `illustration-like image has many colors (got ${illustration.colorCountEstimate})`)
  assertEqual(illustration.recommendedPreset, 'illustration', 'illustration-like image recommends the illustration preset')
  console.log(
    `PASS: illustration-like image (colors=${illustration.colorCountEstimate}, complexity=${illustration.complexityScore.toFixed(2)}) -> illustration`,
  )

  // 5. Photo-like: noisy, high complexity
  const photo = analyzeImage(makePhotoLike())
  assertTrue(photo.complexityScore >= 0.6, `photo-like image has high complexity (got ${photo.complexityScore.toFixed(2)})`)
  assertEqual(photo.recommendedPreset, 'photo', 'photo-like (noisy) image recommends the photo preset')
  console.log(`PASS: photo-like image (colors=${photo.colorCountEstimate}, complexity=${photo.complexityScore.toFixed(2)}) -> photo`)

  console.log('\nAll analyzeImage smoke tests passed.')
}

run().catch((error: unknown) => {
  console.error('Smoke test failed:', error)
  throw error
})
