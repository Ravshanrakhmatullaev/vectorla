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

function peakOf(make: () => { width: number; height: number; data: Uint8ClampedArray }, mode: 'quick' | 'professional') {
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
  const result = traceOwnedImage(holder, { ...engineOptionsFor(mode), sourceFormat: 'png' })
  memoryCheckpoints.hook = null
  return { peak, where, working: `${result.stats.workingWidth}x${result.stats.workingHeight}` }
}

// Measured: 39.5 MB (artwork, both modes), 19.1 MB (photo). Workerd measurements of real
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
console.log('\nAll engine memory smoke tests passed.')
