// Local smoke test for header-only dimension reading and the
// decompression-bomb guard (providers/imageDimensions.ts).
//
// Run with: npx tsx src/providers/imageDimensions.smoke-test.ts (from inside backend/)
import { readImageDimensions, assertDecodableDimensions } from './imageDimensions'
import { decodeImage } from './imageDecoder'
import { loadDecoderWasmModules } from '../testSupport/wasmTestFixtures'
import { encodeTestJpeg, encodeTestPng } from '../testSupport/rasterEncode'
import { readFileSync } from '../testSupport/node-fs.js'
import { PayloadTooLargeError, ValidationError } from '../errors'

function assertTrue(condition: boolean, message: string): void {
  if (!condition) throw new Error(message)
}

function makeImage(width: number, height: number): ImageData {
  const data = new Uint8ClampedArray(width * height * 4).fill(200)
  return { width, height, data } as ImageData
}

async function expectThrows(fn: () => unknown | Promise<unknown>, type: new (...args: never[]) => Error, message: string): Promise<void> {
  try {
    await fn()
  } catch (error) {
    if (error instanceof type) return
    throw new Error(`${message}: threw ${String(error)} instead of ${type.name}`)
  }
  throw new Error(`${message}: did not throw`)
}

interface NodeWebAssembly {
  compile(bytes: Uint8Array): Promise<WebAssembly.Module>
}

async function encodeWebp(image: ImageData, lossless: boolean): Promise<ArrayBuffer> {
  const wasm = await (WebAssembly as unknown as NodeWebAssembly).compile(await readFileSync('node_modules/@jsquash/webp/codec/enc/webp_enc.wasm'))
  const { init, default: encode } = await import('@jsquash/webp/encode.js')
  await init(wasm)
  return encode(image, { lossless: lossless ? 1 : 0 })
}

async function run(): Promise<void> {
  // 1. Real encoder output: dimensions read from headers match exactly.
  const cases: [string, ArrayBuffer][] = [
    ['image/png', await encodeTestPng(makeImage(321, 123))],
    ['image/jpeg', await encodeTestJpeg(makeImage(321, 123))],
    ['image/webp', await encodeWebp(makeImage(321, 123), false)],
    ['image/webp', await encodeWebp(makeImage(321, 123), true)],
  ]
  for (const [mimeType, bytes] of cases) {
    const d = readImageDimensions(new Uint8Array(bytes), mimeType)
    assertTrue(d?.width === 321 && d.height === 123, `${mimeType}: expected 321x123, got ${JSON.stringify(d)}`)
  }
  console.log('PASS: PNG / JPEG / WebP lossy / WebP lossless headers read as 321x123')

  // 2. A forged PNG whose IHDR claims 30000x30000 is rejected before decoding.
  const bomb = new Uint8Array(await encodeTestPng(makeImage(8, 8)))
  const view = new DataView(bomb.buffer)
  view.setUint32(16, 30000)
  view.setUint32(20, 30000)
  await expectThrows(() => assertDecodableDimensions(bomb, 'image/png'), PayloadTooLargeError, 'bomb header')
  const wasm = await loadDecoderWasmModules()
  await expectThrows(() => decodeImage('image/png', bomb.buffer, wasm), PayloadTooLargeError, 'decodeImage on bomb')
  console.log('PASS: 30000x30000 forged PNG rejected with PayloadTooLargeError before decode')

  // 3. One side too long is rejected even if the pixel count is modest.
  view.setUint32(16, 20000)
  view.setUint32(20, 10)
  await expectThrows(() => assertDecodableDimensions(bomb, 'image/png'), PayloadTooLargeError, 'too-wide header')
  console.log('PASS: 20000x10 rejected (max side exceeded)')

  // 4. Unreadable / zero-sized headers are validation errors.
  await expectThrows(() => assertDecodableDimensions(new Uint8Array(10), 'image/png'), ValidationError, 'truncated header')
  view.setUint32(16, 0)
  await expectThrows(() => assertDecodableDimensions(bomb, 'image/png'), ValidationError, 'zero width')
  await expectThrows(() => decodeImage('image/png', new Uint8Array(10).buffer, wasm), Error, 'decodeImage on truncated header')
  console.log('PASS: truncated and zero-sized headers rejected with ValidationError')

  // 5. Normal images still decode.
  const ok = await decodeImage('image/jpeg', cases[1]![1], wasm)
  assertTrue(ok.width === 321 && ok.height === 123, 'normal JPEG still decodes')
  console.log('PASS: normal images still decode')

  console.log('\nAll image dimension guard smoke tests passed.')
}

run().catch((error: unknown) => {
  console.error('Smoke test failed:', error)
  throw error
})
