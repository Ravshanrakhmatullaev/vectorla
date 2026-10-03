// Smoke test for providers/imageDecoder.ts: decoders keep working when they
// are re-initialized after every decode (which releases their grown
// WebAssembly memory), and decodeForTrace hands the engine a working-size
// image plus the upload's real size.
//
// Run with: npx tsx src/providers/imageDecoder.smoke-test.ts (from inside backend/)
import { decodeForTrace, decodeImage } from './imageDecoder'
import { loadDecoderWasmModules, createTestPng, createTestJpeg, createTestWebp } from '../testSupport/wasmTestFixtures'
import { encodeTestPng } from '../testSupport/rasterEncode'

function assertTrue(condition: boolean, message: string): void {
  if (!condition) throw new Error(message)
}

async function run(): Promise<void> {
  const wasm = await loadDecoderWasmModules()

  // 1. Repeated decodes (re-init in between) give identical pixels, per format.
  for (const [mime, make] of [
    ['image/png', createTestPng],
    ['image/jpeg', createTestJpeg],
    ['image/webp', createTestWebp],
  ] as const) {
    const bytes = await make()
    const first = await decodeImage(mime, bytes.slice(0), wasm)
    for (let i = 0; i < 3; i++) {
      const again = await decodeImage(mime, bytes.slice(0), wasm)
      assertTrue(again.width === first.width && again.height === first.height, `${mime}: same size on decode ${i + 2}`)
      assertTrue(again.data.every((v, k) => v === first.data[k]), `${mime}: same pixels on decode ${i + 2}`)
    }
  }
  console.log('PASS: PNG/JPEG/WebP decode identically four times in a row (decoder re-init after each decode)')

  // 2. decodeForTrace reduces large images to the working size and reports the real size.
  const w = 400
  const h = 300
  const data = new Uint8ClampedArray(w * h * 4)
  for (let p = 0; p < w * h; p++) data.set(p % w < 200 ? [200, 40, 40, 255] : [40, 40, 200, 255], p * 4)
  const png = await encodeTestPng({ width: w, height: h, data } as ImageData)
  const fitted = await decodeForTrace('image/png', png.slice(0), wasm, 30_000)
  assertTrue(fitted.sourceSize.width === 400 && fitted.sourceSize.height === 300, 'sourceSize is the upload size')
  assertTrue(fitted.image.width * fitted.image.height <= 30_000, `working image within the cap (${fitted.image.width}x${fitted.image.height})`)
  assertTrue(Math.abs(fitted.image.width / fitted.image.height - 4 / 3) < 0.02, 'aspect ratio kept')
  const small = await decodeForTrace('image/png', png.slice(0), wasm, 1_000_000)
  assertTrue(small.image.width === 400 && small.image.height === 300, 'images under the cap are not resampled')
  let inspected = 0
  await decodeForTrace('image/png', png.slice(0), wasm, 30_000, (full) => (inspected = full.width * full.height))
  assertTrue(inspected === 120_000, 'inspect callback sees the full-resolution image')
  console.log(`PASS: decodeForTrace -> ${fitted.image.width}x${fitted.image.height} working image, sourceSize 400x300, full image passed to inspect`)

  console.log('\nAll image decoder smoke tests passed.')
}

run().catch((error: unknown) => {
  console.error('Image decoder smoke test failed:', error)
  throw error
})
