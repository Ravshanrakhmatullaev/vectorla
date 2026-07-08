// Test-only helpers for exercising the real PlaceholderProvider (Phase 19)
// locally via plain Node/tsx, with no wrangler bundler and no real Cloudflare
// deploy. Never imported by src/index.ts or anything it pulls in, so this
// (and its `node:fs` usage, unavailable in the actual Worker) never ships in
// the deployed bundle — same reasoning as the *.smoke-test.ts files
// themselves, which also live under src/ without being part of the Worker.
//
// In production, the three decoder .wasm files are supplied as
// WebAssembly.Module bindings by wrangler.toml's [[wasm_modules]] (compiled
// at bundle time, no filesystem access needed). Here, we read the exact same
// files straight off disk instead, since tsx has no .wasm loader.
import { readFileSync } from './node-fs.js'
import type { RasterDecoderWasm } from '../providers/PlaceholderProvider'

// @cloudflare/workers-types' WebAssembly namespace doesn't declare compile()
// — Workers only ever hands you an already-compiled Module via a binding, so
// it isn't part of that surface — even though Node genuinely has it at
// runtime. The cast below only works around the type gap; see node-fs.ts for
// the sibling gap on the `node:fs` side.
interface NodeWebAssembly {
  compile(bytes: Uint8Array): Promise<WebAssembly.Module>
}

async function loadWasmModule(relativePath: string): Promise<WebAssembly.Module> {
  const bytes = await readFileSync(relativePath)
  return (WebAssembly as unknown as NodeWebAssembly).compile(bytes)
}

export async function loadDecoderWasmModules(): Promise<RasterDecoderWasm> {
  const [png, jpeg, webp] = await Promise.all([
    loadWasmModule('node_modules/@jsquash/png/codec/pkg/squoosh_png_bg.wasm'),
    loadWasmModule('node_modules/@jsquash/jpeg/codec/dec/mozjpeg_dec.wasm'),
    loadWasmModule('node_modules/@jsquash/webp/codec/dec/webp_dec.wasm'),
  ])
  return { png, jpeg, webp }
}

interface SyntheticImageData {
  width: number
  height: number
  data: Uint8ClampedArray
}

/** A small, deliberately non-uniform image — flat colors, hard edges, so tracing actually produces multiple distinct paths. */
function makeSyntheticImageData(size = 8): SyntheticImageData {
  const data = new Uint8ClampedArray(size * size * 4)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4
      const quadrant = (x < size / 2 ? 0 : 1) + (y < size / 2 ? 0 : 2)
      data[i] = quadrant === 0 ? 220 : 10
      data[i + 1] = quadrant === 1 ? 220 : 10
      data[i + 2] = quadrant === 2 ? 220 : quadrant === 3 ? 220 : 10
      data[i + 3] = 255
    }
  }
  return { width: size, height: size, data }
}

/** Encodes a real, valid PNG for tests — only used by tests; production never encodes raster, only decodes. */
export async function createTestPng(): Promise<ArrayBuffer> {
  const wasm = await loadWasmModule('node_modules/@jsquash/png/codec/pkg/squoosh_png_bg.wasm')
  const { init, default: encode } = await import('@jsquash/png/encode.js')
  await init(wasm)
  return encode(makeSyntheticImageData())
}

export async function createTestJpeg(): Promise<ArrayBuffer> {
  const wasm = await loadWasmModule('node_modules/@jsquash/jpeg/codec/enc/mozjpeg_enc.wasm')
  const { init, default: encode } = await import('@jsquash/jpeg/encode.js')
  await init(wasm)
  return encode(makeSyntheticImageData())
}

export async function createTestWebp(): Promise<ArrayBuffer> {
  const wasm = await loadWasmModule('node_modules/@jsquash/webp/codec/enc/webp_enc.wasm')
  const { init, default: encode } = await import('@jsquash/webp/encode.js')
  await init(wasm)
  return encode(makeSyntheticImageData())
}
