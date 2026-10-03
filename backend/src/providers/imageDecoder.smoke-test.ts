// Smoke test for providers/imageDecoder.ts: decoders keep working when they
// are re-initialized after every decode (which releases their grown
// WebAssembly memory), and decodeForTrace hands the engine a working-size
// image plus the upload's real size.
//
// Run with: npx tsx src/providers/imageDecoder.smoke-test.ts (from inside backend/)
import { decodeForTrace, decodeImage } from './imageDecoder'
import { loadDecoderWasmModules, createTestPng, createTestJpeg, createTestWebp } from '../testSupport/wasmTestFixtures'
import { encodeTestJpeg, encodeTestPng } from '../testSupport/rasterEncode'
import { stripJpegMetadata } from './jpegSegments'
import { PayloadTooLargeError } from '../errors'
import { init as initJsquashPng, default as decodeJsquashPng } from '@jsquash/png/decode.js'

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
  const fitted = await decodeForTrace('image/png', png.slice(0), wasm, { maxWorkingPixels: 30_000, photoMaxWorkingPixels: 30_000 })
  assertTrue(fitted.sourceSize.width === 400 && fitted.sourceSize.height === 300, 'sourceSize is the upload size')
  assertTrue(fitted.image!.width * fitted.image!.height <= 30_000, `working image within the cap (${fitted.image!.width}x${fitted.image!.height})`)
  assertTrue(Math.abs(fitted.image!.width / fitted.image!.height - 4 / 3) < 0.02, 'aspect ratio kept')
  const small = await decodeForTrace('image/png', png.slice(0), wasm, { maxWorkingPixels: 1_000_000, photoMaxWorkingPixels: 1_000_000 })
  assertTrue(small.image!.width === 400 && small.image!.height === 300, 'images under the cap are not resampled')
  let inspected = 0
  await decodeForTrace('image/png', png.slice(0), wasm, { maxWorkingPixels: 30_000, photoMaxWorkingPixels: 30_000 }, (full) => (inspected = full.width * full.height))
  assertTrue(inspected === 120_000, 'inspect callback sees the full-resolution image')
  console.log(`PASS: decodeForTrace -> ${fitted.image!.width}x${fitted.image!.height} working image, sourceSize 400x300, full image passed to inspect`)

  // 3. PNG decodes on a fresh WebAssembly instance per call (pngDecoder.ts):
  // pixels match @jsquash/png's own decoder, and no decoder memory is kept.
  const big = new Uint8ClampedArray(1000 * 1000 * 4)
  for (let p = 0; p < 1000 * 1000; p++) big.set([(p * 7) & 255, (p >> 10) & 255, 90, 255], p * 4)
  const bigPng = await encodeTestPng({ width: 1000, height: 1000, data: big } as ImageData)
  await initJsquashPng(wasm.png)
  const reference = await decodeJsquashPng(bigPng.slice(0))
  const fresh = await decodeImage('image/png', bigPng.slice(0), wasm)
  assertTrue(fresh.width === reference.width && fresh.data.every((v, k) => v === reference.data[k]), 'fresh-instance PNG decode matches @jsquash/png')
  console.log('PASS: PNG decodes on a per-call WebAssembly instance, identical to @jsquash/png (memory release: engine/memory.smoke-test.ts)')

  // 4. JPEG padding: metadata never reaches the decoder, and a file far
  // larger than its pixels justify is rejected before decoding.
  const jpeg = await encodeTestJpeg({ width: 400, height: 300, data } as ImageData, 90)
  const plain = new Uint8Array(jpeg)
  const comment = new Uint8Array(65535)
  comment.set([0xff, 0xfe, 0xff, 0xfd])
  const padded = (segments: number) => {
    const out = new Uint8Array(plain.length + segments * comment.length)
    out.set(plain.subarray(0, 2))
    for (let k = 0; k < segments; k++) out.set(comment, 2 + k * comment.length)
    out.set(plain.subarray(2), 2 + segments * comment.length)
    return out.buffer
  }
  const lightlyPadded = padded(4)
  assertTrue(stripJpegMetadata(lightlyPadded).byteLength === plain.length, 'comment segments are stripped before decoding')
  const viaPadded = await decodeImage('image/jpeg', lightlyPadded, wasm)
  const viaPlain = await decodeImage('image/jpeg', jpeg.slice(0), wasm)
  assertTrue(viaPadded.data.every((v, k) => v === viaPlain.data[k]), 'a padded JPEG decodes to the same pixels')
  let rejected = false
  try {
    await decodeImage('image/jpeg', padded(40), wasm) // 2.6 MB for 400x300
  } catch (error) {
    rejected = error instanceof PayloadTooLargeError
  }
  assertTrue(rejected, 'a JPEG far larger than its pixel count is rejected with 413')
  console.log('PASS: JPEG metadata padding is stripped before decode; oversized-for-its-pixels files are rejected')

  console.log('\nAll image decoder smoke tests passed.')
}

run().catch((error: unknown) => {
  console.error('Image decoder smoke test failed:', error)
  throw error
})
