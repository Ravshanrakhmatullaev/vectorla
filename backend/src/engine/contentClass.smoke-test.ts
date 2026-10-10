// Content classification (traceImage.ts classifyContent, workingPixelCap):
// a shaded, compressed emblem is photo-like by flat fraction but must stay
// at full resolution, while photos keep the photo working-size cap. Uses the
// customer's emblem and the real-world photos (src/benchmark/assets).
// See BENCHMARKS.md "Content classes".
//
// Run with: npx tsx src/engine/contentClass.smoke-test.ts (from inside backend/)
import { classifyContent, emblemFeatures, workingPixelCap } from './traceImage'
import { engineOptionsFor, workingCaps } from './profiles'
import { upscaleBilinear, type RgbaImage } from './raster'
import { decodeImage } from '../providers/imageDecoder'
import { loadDecoderWasmModules } from '../testSupport/wasmTestFixtures'
import { readFileSync } from '../testSupport/node-fs.js'

function assertTrue(condition: boolean, message: string): void {
  if (!condition) throw new Error(message)
}

const ASSETS = 'src/benchmark/assets'
const wasm = await loadDecoderWasmModules()
async function load(file: string): Promise<RgbaImage> {
  const bytes = await readFileSync(`${ASSETS}/${file}`)
  const mime = file.endsWith('.png') ? 'image/png' : file.endsWith('.webp') ? 'image/webp' : 'image/jpeg'
  const d = await decodeImage(mime, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer, wasm)
  return { width: d.width, height: d.height, data: new Uint8ClampedArray(d.data) }
}
const describe = (image: RgbaImage) => {
  const f = emblemFeatures(image)
  return `border ${f.border.toFixed(2)}, crispness ${f.crispness.toFixed(2)}`
}

// The customer's emblem: 32% flat pixels, plain white border, crisp outlines.
const emblem = await load('customer/emblem-sanoat-radiatsiya-640.webp')
assertTrue(classifyContent(emblem) === 'emblem', `customer emblem classified as ${classifyContent(emblem)} (${describe(emblem)})`)
console.log(`PASS: customer emblem is an emblem (${describe(emblem)})`)

// The same emblem uploaded large: before the emblem class, a 1280² copy was
// reduced to 640² by the photo cap in Quick, and a 2000² one to 1000² in both
// modes, losing its lettering and line art (BENCHMARKS.md "Content classes").
for (const factor of [2, 3]) {
  const large = upscaleBilinear(emblem, factor)
  assertTrue(classifyContent(large) === 'emblem', `${large.width}² emblem classified as ${classifyContent(large)} (${describe(large)})`)
  for (const mode of ['quick', 'professional'] as const) {
    const caps = workingCaps(engineOptionsFor(mode))
    assertTrue(workingPixelCap(large, caps) === caps.maxWorkingPixels, `${mode}: ${large.width}² emblem gets the photo cap`)
  }
  console.log(`PASS: ${large.width}² emblem keeps full resolution in both modes`)
}

// Photos stay photos, at their own size and as large camera photos (4x,
// with sensor noise: 1.2-4 MP), whose working size is the photo class's
// (reduced, unless upsampling would restore the size anyway).
let seed = 5
const noisy = (image: RgbaImage): RgbaImage => {
  const data = image.data
  for (let i = 0; i < data.length; i += 4) {
    for (let c = 0; c < 3; c++) data[i + c] = data[i + c]! + (((seed = (seed * 1103515245 + 12345) & 0x7fffffff) % 13) - 6)
  }
  return image
}
for (const file of ['astronaut.jpg', 'camera.jpg', 'chelsea.jpg', 'coffee.jpg', 'coins.jpg', 'rocket.jpg']) {
  const photo = await load(`photos/${file}`)
  assertTrue(classifyContent(photo) === 'photo', `${file} classified as ${classifyContent(photo)} (${describe(photo)})`)
  const large = noisy(upscaleBilinear(photo, 4))
  assertTrue(classifyContent(large) === 'photo', `${file} at ${large.width}x${large.height} classified as ${classifyContent(large)} (${describe(large)})`)
  for (const mode of ['quick', 'professional'] as const) {
    const caps = workingCaps(engineOptionsFor(mode))
    const cap = workingPixelCap(large, caps)
    assertTrue(cap === workingPixelCap(large, { ...caps, contentClass: 'photo' }), `${mode}: ${file} at ${large.width}x${large.height} lost the photo cap (${describe(large)})`)
    if (large.width * large.height >= 3_000_000) assertTrue(cap < caps.maxWorkingPixels, `${mode}: ${file} at ${large.width}x${large.height} is not reduced`)
  }
  console.log(`PASS: ${file} is a photo (${describe(photo)}); at ${large.width}x${large.height} still a photo (${describe(large)})`)
}

// Clean artwork is not affected (flat fraction above the photo threshold).
const horse = await load('photos/horse.png')
assertTrue(classifyContent(horse) === 'artwork', `horse silhouette classified as ${classifyContent(horse)}`)
console.log('PASS: a clean silhouette is artwork')
console.log('\nContent classification tests passed.')
