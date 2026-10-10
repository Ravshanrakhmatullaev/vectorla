// Memory regression test for the tracing engine. Traces a 4 MP artwork
// image (full resolution) and a 4 MP photo-like image (photo cap) through the
// production path (decode-free: traceOwnedImage, as the queue consumer does
// after decodeForTrace), forcing a GC at every in-stage checkpoint
// (engine/memoryCheckpoint.ts), and fails if the true live peak grows past
// its budget. Budgets sit ~15% above the values measured in BENCHMARKS.md
// "High-resolution engine" and well under half of a Worker's 128 MB.
//
// Run with: npx tsx src/engine/memory.smoke-test.ts (from inside backend/);
// it re-launches itself with --expose-gc when needed.
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { traceOwnedImage } from './traceImage'
import { engineOptionsFor } from './profiles'
import { memoryCheckpoints } from './memoryCheckpoint'
import { decodeImage } from '../providers/imageDecoder'
import { loadDecoderWasmModules } from '../testSupport/wasmTestFixtures'

const gc = (globalThis as { gc?: () => void }).gc
if (!gc) {
  const run = spawnSync(process.execPath, ['--expose-gc', '--no-concurrent-array-buffer-sweeping', '--import', 'tsx', fileURLToPath(import.meta.url)], { stdio: 'inherit' })
  process.exit(run.status ?? 1)
}

function assertTrue(condition: boolean, message: string): void {
  if (!condition) throw new Error(message)
}

const mb = () => {
  const m = process.memoryUsage()
  return (m.heapUsed + m.arrayBuffers) / 1048576
}

/** 2000×2000 flat artwork: rings, bars and text-like strokes, anti-aliased. */
function artwork(): { width: number; height: number; data: Uint8ClampedArray } {
  const w = 2000
  const h = 2000
  const data = new Uint8ClampedArray(w * h * 4)
  const colors = [
    [250, 250, 245],
    [20, 60, 150],
    [230, 120, 30],
    [40, 160, 90],
  ] as const
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const d = Math.hypot(x - 1000, y - 1000)
      let c = 0
      if (d < 900 && d > 820) c = 1
      else if (d < 600 && ((x >> 6) + (y >> 6)) % 3 === 0) c = 2
      else if (y > 1650 && y < 1700 && x > 300 && x < 1700 && (x >> 4) % 2 === 0) c = 3
      // Soft (anti-aliased) ring edges.
      const t = d >= 818 && d <= 822 ? (d - 818) / 4 : d >= 898 && d <= 902 ? 1 - (d - 898) / 4 : -1
      const base = colors[c]!
      const p = (y * w + x) * 4
      if (t >= 0) {
        const a = colors[0]
        const b = colors[1]
        for (let k = 0; k < 3; k++) data[p + k] = Math.round(a[k]! * (1 - t) + b[k]! * t)
      } else for (let k = 0; k < 3; k++) data[p + k] = base[k]!
      data[p + 3] = 255
    }
  }
  return { width: w, height: h, data }
}

/** 2448×1632 photo-like image: smooth shading plus sensor noise. */
function photo(): { width: number; height: number; data: Uint8ClampedArray } {
  const w = 2448
  const h = 1632
  const data = new Uint8ClampedArray(w * h * 4)
  let seed = 7
  const noise = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) % 17) - 8
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = (y * w + x) * 4
      data[p] = 120 + 80 * Math.sin(x / 180) + noise()
      data[p + 1] = 110 + 60 * Math.cos(y / 140) + noise()
      data[p + 2] = 100 + 50 * Math.sin((x + y) / 260) + noise()
      data[p + 3] = 255
    }
  }
  return { width: w, height: h, data }
}

function peakOf(make: () => { width: number; height: number; data: Uint8ClampedArray }, mode: 'quick' | 'professional', sourceFormat: 'png' | 'jpeg' = 'png') {
  gc!()
  const base = mb()
  let image: { width: number; height: number; data: Uint8ClampedArray } | null = make()
  let peak = 0
  let where = ''
  memoryCheckpoints.hook = (label) => {
    gc!()
    const v = mb() - base
    if (v > peak) {
      peak = v
      where = label
    }
  }
  const holder = { image }
  image = null
  const result = traceOwnedImage(holder, { ...engineOptionsFor(mode), sourceFormat })
  memoryCheckpoints.hook = null
  return { peak, where, working: `${result.stats.workingWidth}x${result.stats.workingHeight}`, contentClass: result.stats.diagnostics.contentClass }
}

// Measured: 39.3 MB (artwork, Professional), 43.1 MB (artwork, Quick: includes
// the dense-pattern undo copy of the labels, traceImage.ts), 19.1 MB (photo). Workerd measurements of real
// 4 MP uploads (BENCHMARKS.md): 61 MB photo at full resolution (not used), 47 MB logo.
const BUDGET_ARTWORK_4MP_MB = 46
const BUDGET_PHOTO_4MP_MB = 23

for (const mode of ['quick', 'professional'] as const) {
  // The input buffer itself (16 MB) is handed over to the engine and counted.
  const art = peakOf(artwork, mode)
  assertTrue(art.working === '2000x2000', `${mode}: 4 MP artwork is traced at full resolution (got ${art.working})`)
  assertTrue(art.peak <= BUDGET_ARTWORK_4MP_MB, `${mode}: 4 MP artwork live peak ${art.peak.toFixed(1)} MB at ${art.where} exceeds ${BUDGET_ARTWORK_4MP_MB} MB`)
  console.log(`PASS: ${mode} 4 MP artwork at ${art.working}: live peak ${art.peak.toFixed(1)} MB (${art.where}) <= ${BUDGET_ARTWORK_4MP_MB} MB`)

  const ph = peakOf(photo, mode)
  assertTrue(ph.working === '1224x816', `${mode}: 4 MP photo is reduced exactly 2x to the photo cap (got ${ph.working})`)
  assertTrue(ph.peak <= BUDGET_PHOTO_4MP_MB, `${mode}: 4 MP photo live peak ${ph.peak.toFixed(1)} MB at ${ph.where} exceeds ${BUDGET_PHOTO_4MP_MB} MB`)
  console.log(`PASS: ${mode} 4 MP photo at ${ph.working}: live peak ${ph.peak.toFixed(1)} MB (${ph.where}) <= ${BUDGET_PHOTO_4MP_MB} MB`)
}

// Shaded 4 MP emblem-like artwork (Professional): an off-center radial disk,
// a gradient ring and flat bars. Exercises gradient reconstruction and the
// shading refinement stage (refine.ts), whose interior-distance map is alive
// on top of the label and id buffers. Measured 43.2 MB (refineShading).
const BUDGET_SHADED_4MP_MB = 50
{
  const shaded = () => {
    const n = 2000
    const data = new Uint8ClampedArray(n * n * 4)
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const d = Math.hypot(x - 1000, y - 1000)
        let rgb: [number, number, number] = [255, 255, 255]
        if (d < 960 && d >= 820) {
          // Angular metal shading: no linear or radial fit, so it is refined.
          const t = 0.5 + 0.5 * Math.sin(3 * Math.atan2(y - 1000, x - 1000))
          rgb = [235 - 110 * t, 200 - 120 * t, 90 - 70 * t]
        } else if (d < 820) {
          const t = Math.min(1, Math.hypot(x - 820, y - 760) / 1100)
          rgb = [60 - 45 * t, 125 - 85 * t, 215 - 120 * t]
        }
        if (y > 950 && y < 1050 && x > 500 && x < 1500 && (x >> 5) % 3 !== 0) rgb = [245, 245, 245]
        data.set([Math.round(rgb[0]), Math.round(rgb[1]), Math.round(rgb[2]), 255], (y * n + x) * 4)
      }
    }
    return { width: n, height: n, data }
  }
  const sh = peakOf(shaded, 'professional')
  assertTrue(sh.working === '2000x2000', `shaded 4 MP artwork is traced at full resolution (got ${sh.working})`)
  assertTrue(sh.peak <= BUDGET_SHADED_4MP_MB, `professional: shaded 4 MP artwork live peak ${sh.peak.toFixed(1)} MB at ${sh.where} exceeds ${BUDGET_SHADED_4MP_MB} MB`)
  console.log(`PASS: professional shaded 4 MP artwork: live peak ${sh.peak.toFixed(1)} MB (${sh.where}) <= ${BUDGET_SHADED_4MP_MB} MB`)
}

// Textured 4 MP emblem (JPEG path): a noisy, shaded metal disk with crisp
// rings, stroke lettering and line art on a plain background. Photo-like by
// flat fraction, but classified as an emblem, so it is traced at full
// resolution instead of the 1.2 MP photo cap (traceImage.ts classifyContent),
// with the texture path (label regularization) and the region budget's
// detail-first passes. Measured 39.4 MB (Quick), 43.3 MB (Professional);
// before the emblem class it was traced at 1000² (photo cap). Its own
// budget; the artwork budget above is unchanged.
const BUDGET_TEXTURED_EMBLEM_4MP_MB = 54
{
  const emblem = () => {
    const n = 2000
    const data = new Uint8ClampedArray(n * n * 4)
    let seed = 11
    const noise = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) % 25) - 12
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const d = Math.hypot(x - 1000, y - 1000)
        const angle = Math.atan2(y - 1000, x - 1000)
        let rgb: [number, number, number] = [255, 255, 255]
        if (d < 940) {
          const t = d / 940
          const e = noise()
          rgb = [205 - 70 * t + e, 175 - 60 * t + e, 95 - 45 * t + e]
          const ring = (d > 860 && d < 880) || (d > 700 && d < 712)
          const letter = d > 740 && d < 840 && Math.floor((angle * 360) / Math.PI) % 3 === 0 && ((x >> 3) + (y >> 3)) % 2 === 0
          const spoke = d < 600 && Math.abs(((angle * 12) / Math.PI) % 1) < 0.02
          if (ring || letter || spoke) rgb = [30 + e, 30 + e, 40 + e]
        }
        data.set([rgb[0], rgb[1], rgb[2], 255], (y * n + x) * 4)
      }
    }
    return { width: n, height: n, data }
  }
  for (const mode of ['quick', 'professional'] as const) {
    const em = peakOf(emblem, mode, 'jpeg')
    assertTrue(em.contentClass === 'emblem', `${mode}: textured emblem classified as ${em.contentClass}`)
    assertTrue(em.working === '2000x2000', `${mode}: textured 4 MP emblem is traced at full resolution (got ${em.working})`)
    assertTrue(em.peak <= BUDGET_TEXTURED_EMBLEM_4MP_MB, `${mode}: textured 4 MP emblem live peak ${em.peak.toFixed(1)} MB at ${em.where} exceeds ${BUDGET_TEXTURED_EMBLEM_4MP_MB} MB`)
    console.log(`PASS: ${mode} textured 4 MP emblem at ${em.working}: live peak ${em.peak.toFixed(1)} MB (${em.where}) <= ${BUDGET_TEXTURED_EMBLEM_4MP_MB} MB`)
  }
}

// Dense regular pattern: a 2000² checkerboard of 16 px squares has 15,625
// regions per colour, above the soft region budget. The budget pass no longer
// collapses it (traceImage.ts maxRegionsHard), so every square is kept, at a
// higher peak than ordinary artwork. Measured 58.8 MB.
const BUDGET_CHECKER_16_MB = 68
{
  const checker = () => {
    const n = 2000
    const data = new Uint8ClampedArray(n * n * 4)
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const v = (((x >> 4) + (y >> 4)) & 1) * 255
        data.set([v, v, v, 255], (y * n + x) * 4)
      }
    }
    return { width: n, height: n, data }
  }
  const c = peakOf(checker, 'professional')
  assertTrue(c.peak <= BUDGET_CHECKER_16_MB, `16 px checkerboard live peak ${c.peak.toFixed(1)} MB at ${c.where} exceeds ${BUDGET_CHECKER_16_MB} MB`)
  console.log(`PASS: 2000² 16 px checkerboard: live peak ${c.peak.toFixed(1)} MB (${c.where}) <= ${BUDGET_CHECKER_16_MB} MB`)
}

/** RGBA PNG with stored (uncompressed) deflate blocks, so building it needs no PNG codec instance. */
function storedPng(width: number, height: number, rgba: Uint8ClampedArray): ArrayBuffer {
  const crcTable = new Int32Array(256).map((_, n) => {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    return c
  })
  const crc32 = (bytes: Uint8Array) => {
    let c = -1
    for (const b of bytes) c = crcTable[(c ^ b) & 255]! ^ (c >>> 8)
    return (c ^ -1) >>> 0
  }
  const raw = new Uint8Array(height * (width * 4 + 1))
  for (let y = 0; y < height; y++) raw.set(rgba.subarray(y * width * 4, (y + 1) * width * 4), y * (width * 4 + 1) + 1)
  const blocks = Math.ceil(raw.length / 65535)
  const zlib = new Uint8Array(2 + raw.length + blocks * 5 + 4)
  zlib.set([0x78, 0x01])
  let o = 2
  for (let k = 0; k < blocks; k++) {
    const chunk = raw.subarray(k * 65535, Math.min(raw.length, (k + 1) * 65535))
    zlib.set([k === blocks - 1 ? 1 : 0, chunk.length & 255, chunk.length >> 8, ~chunk.length & 255, (~chunk.length >> 8) & 255], o)
    zlib.set(chunk, o + 5)
    o += 5 + chunk.length
  }
  let a = 1
  let b = 0
  for (const v of raw) {
    a = (a + v) % 65521
    b = (b + a) % 65521
  }
  new DataView(zlib.buffer).setUint32(o, ((b << 16) | a) >>> 0)
  const chunk = (type: string, data: Uint8Array) => {
    const out = new Uint8Array(12 + data.length)
    const view = new DataView(out.buffer)
    view.setUint32(0, data.length)
    out.set([...type].map((ch) => ch.charCodeAt(0)), 4)
    out.set(data, 8)
    view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)))
    return out
  }
  const ihdr = new Uint8Array(13)
  new DataView(ihdr.buffer).setUint32(0, width)
  new DataView(ihdr.buffer).setUint32(4, height)
  ihdr.set([8, 6, 0, 0, 0], 8)
  const parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib), chunk('IEND', new Uint8Array(0))]
  const file = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let at = 0
  for (const p of parts) {
    file.set(p, at)
    at += p.length
  }
  return file.buffer
}

// Decoders: WebAssembly memory only grows, so a decoder instance that
// outlives its decode keeps its peak for the life of the isolate (39 MB after
// a 4 MP PNG with @jsquash/png's shared instance). Every decode must leave
// nothing behind. WebAssembly memory is external to the JS heap, so this
// measures process external memory.
{
  const wasm = await loadDecoderWasmModules()
  const w = 2000
  const h = 2000
  const pixels = new Uint8ClampedArray(w * h * 4)
  for (let p = 0; p < w * h; p++) pixels.set([(p * 7) & 255, (p >> 11) & 255, 90, 255], p * 4)
  const png = storedPng(w, h, pixels)
  const external = () => {
    gc!()
    gc!()
    return process.memoryUsage().external / 1048576
  }
  // Measured from before the first decode: a shared decoder instance would
  // keep what the first decode grew it to.
  const before = external()
  for (let i = 0; i < 3; i++) await decodeImage('image/png', png.slice(0), wasm)
  const retained = external() - before
  assertTrue(retained < 4, `4 MP PNG decodes leave decoder memory behind (${retained.toFixed(1)} MB)`)
  console.log(`PASS: three 4 MP PNG decodes retain ${retained.toFixed(1)} MB of decoder memory (< 4 MB)`)
}
console.log('\nAll engine memory smoke tests passed.')
