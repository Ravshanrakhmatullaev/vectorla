// Generalized raster encoders for arbitrary ImageData, test-only (production
// never encodes raster — only decodes, see PlaceholderProvider). Reuses the
// same on-disk wasm loading approach as wasmTestFixtures.ts, generalized to
// take any ImageData instead of one fixed 8x8 fixture.
import { readFileSync } from './node-fs.js'

interface NodeWebAssembly {
  compile(bytes: Uint8Array): Promise<WebAssembly.Module>
}

async function loadWasmModule(relativePath: string): Promise<WebAssembly.Module> {
  const bytes = await readFileSync(relativePath)
  return (WebAssembly as unknown as NodeWebAssembly).compile(bytes)
}

export async function encodeTestPng(imageData: ImageData): Promise<ArrayBuffer> {
  const wasm = await loadWasmModule('node_modules/@jsquash/png/codec/pkg/squoosh_png_bg.wasm')
  const { init, default: encode } = await import('@jsquash/png/encode.js')
  await init(wasm)
  return encode(imageData)
}

export async function encodeTestJpeg(imageData: ImageData): Promise<ArrayBuffer> {
  const wasm = await loadWasmModule('node_modules/@jsquash/jpeg/codec/enc/mozjpeg_enc.wasm')
  const { init, default: encode } = await import('@jsquash/jpeg/encode.js')
  await init(wasm)
  return encode(imageData)
}
