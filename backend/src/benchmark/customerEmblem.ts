/**
 * The customer emblem benchmark: a real 640 px upload (a shaded, compressed
 * state-committee emblem with circular serif text, hazard symbols and a
 * line-art coat of arms) that Vectorla traced far worse than Vectorizer.AI.
 * There is no vector truth, so traces are scored against the source raster
 * itself (BENCHMARKS.md "Customer emblem"):
 *
 *  - ΔE×100: mean OKLab difference inside the emblem.
 *  - Edge recall / precision: color edges (OKLab step > 0.1 after a light
 *    blur) of the source the trace reproduces within 1 px, and edges of the
 *    trace that exist in the source.
 *  - Edge-length ratio: trace edges ÷ source edges (below 1: lost detail;
 *    above 1: speckle and jaggies).
 *  - Lines kept: thin dark lines of the source (lightness valleys at most
 *    ~2 px wide, ≥ 0.12 deeper than both sides) that stay dark in the trace.
 *
 * Every metric is also reported per region (text, hazard symbols, coat of
 * arms, wreath, metal shield, rim). Vectorizer.AI's result was only
 * available as a screenshot of its web page; it was registered onto the
 * source and scored with the same code, and the page's UI overlays (toolbar,
 * labels, download button) are excluded for every engine (OVERLAYS).
 */
export const CUSTOMER_EMBLEM_FILE = 'customer/emblem-sanoat-radiatsiya-640.webp'
export const CUSTOMER_EMBLEM_SIZE = 640

/** Areas the Vectorizer.AI page's UI covered in the reference screenshot (source px: x0, y0, x1, y1). */
const OVERLAYS: [number, number, number, number][] = [
  [202, 0, 439, 26],
  [243, 37, 396, 63],
  [243, 589, 398, 640],
]

export const REGIONS: Record<string, [number, number, number, number][]> = {
  'text-top': [[95, 20, 545, 150]],
  'text-bottom': [[120, 500, 520, 625]],
  'text-sides': [[15, 190, 120, 480], [520, 190, 625, 480]],
  'hazard-symbols': [[150, 140, 490, 305]],
  'coat-of-arms': [[230, 270, 410, 445]],
  wreath: [[185, 255, 455, 500]],
  'metal-shield': [[140, 125, 500, 290]],
  'rim-ring': [[0, 0, 640, 60], [0, 580, 640, 640]],
}

export interface EmblemScore {
  deltaE: number
  edgeRecall: number
  edgePrecision: number
  edgeLengthRatio: number
  linesKept: number
}

/**
 * Vectorizer.AI on the same upload (registered screenshot of its result,
 * 2026-10-10), scored by scoreCustomerEmblem.
 */
export const VECTORIZER_AI_REFERENCE: Record<string, EmblemScore> = {
  all: { deltaE: 4.18, edgeRecall: 0.941, edgePrecision: 0.958, edgeLengthRatio: 0.993, linesKept: 0.978 },
  'text-top': { deltaE: 3.64, edgeRecall: 0.963, edgePrecision: 0.983, edgeLengthRatio: 0.992, linesKept: 0.990 },
  'text-bottom': { deltaE: 3.92, edgeRecall: 0.962, edgePrecision: 0.990, edgeLengthRatio: 0.982, linesKept: 0.987 },
  'text-sides': { deltaE: 4.11, edgeRecall: 0.946, edgePrecision: 0.936, edgeLengthRatio: 1.044, linesKept: 0.987 },
  'hazard-symbols': { deltaE: 4.51, edgeRecall: 0.964, edgePrecision: 0.978, edgeLengthRatio: 1.011, linesKept: 0.984 },
  'coat-of-arms': { deltaE: 6.30, edgeRecall: 0.906, edgePrecision: 0.945, edgeLengthRatio: 0.938, linesKept: 0.945 },
  wreath: { deltaE: 5.46, edgeRecall: 0.899, edgePrecision: 0.943, edgeLengthRatio: 0.941, linesKept: 0.959 },
  'metal-shield': { deltaE: 4.20, edgeRecall: 0.969, edgePrecision: 0.983, edgeLengthRatio: 1.003, linesKept: 0.991 },
  'rim-ring': { deltaE: 4.02, edgeRecall: 0.918, edgePrecision: 0.953, edgeLengthRatio: 0.945, linesKept: 1.000 },
}

function oklab(rgb: Float32Array, n: number): Float32Array {
  const out = new Float32Array(n * 3)
  const lin = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
  for (let p = 0; p < n; p++) {
    const r = lin(rgb[p * 3]!)
    const g = lin(rgb[p * 3 + 1]!)
    const b = lin(rgb[p * 3 + 2]!)
    const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
    const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
    const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
    out[p * 3] = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s
    out[p * 3 + 1] = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s
    out[p * 3 + 2] = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
  }
  return out
}

/** RGBA (any opacity, composited on white) → RGB 0-1. */
function toRgb(rgba: Uint8Array | Uint8ClampedArray, n: number): Float32Array {
  const out = new Float32Array(n * 3)
  for (let p = 0; p < n; p++) {
    const a = rgba[p * 4 + 3]! / 255
    for (let c = 0; c < 3; c++) out[p * 3 + c] = ((rgba[p * 4 + c]! / 255) * a + (1 - a))
  }
  return out
}

/** Separable Gaussian blur (σ px) of an RGB 0-1 image, edges clamped. */
function blur(rgb: Float32Array, w: number, h: number, sigma: number): Float32Array {
  const radius = Math.ceil(3 * sigma)
  const k: number[] = []
  let sum = 0
  for (let i = -radius; i <= radius; i++) {
    const v = Math.exp(-(i * i) / (2 * sigma * sigma))
    k.push(v)
    sum += v
  }
  const kn = k.map((v) => v / sum)
  const tmp = new Float32Array(rgb.length)
  const out = new Float32Array(rgb.length)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      for (let c = 0; c < 3; c++) {
        let s = 0
        for (let i = -radius; i <= radius; i++) s += kn[i + radius]! * rgb[(y * w + Math.min(w - 1, Math.max(0, x + i))) * 3 + c]!
        tmp[(y * w + x) * 3 + c] = s
      }
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      for (let c = 0; c < 3; c++) {
        let s = 0
        for (let i = -radius; i <= radius; i++) s += kn[i + radius]! * tmp[(Math.min(h - 1, Math.max(0, y + i)) * w + x) * 3 + c]!
        out[(y * w + x) * 3 + c] = s
      }
  return out
}

function edgeMap(lab: Float32Array, w: number, h: number, threshold: number): Uint8Array {
  const e = new Uint8Array(w * h)
  const t2 = threshold * threshold
  const d2 = (p: number, q: number) => (lab[p * 3]! - lab[q * 3]!) ** 2 + (lab[p * 3 + 1]! - lab[q * 3 + 1]!) ** 2 + (lab[p * 3 + 2]! - lab[q * 3 + 2]!) ** 2
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const p = y * w + x
      if ((x + 1 < w && d2(p, p + 1) > t2) || (y + 1 < h && d2(p, p + w) > t2)) e[p] = 1
    }
  return e
}

/** 4-neighbour dilation by one pixel. */
function dilate(m: Uint8Array, w: number, h: number): Uint8Array {
  const out = m.slice()
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const p = y * w + x
      if (m[p]) continue
      if ((x > 0 && m[p - 1]) || (x + 1 < w && m[p + 1]) || (y > 0 && m[p - w]) || (y + 1 < h && m[p + w])) out[p] = 1
    }
  return out
}

/**
 * Scores a trace rendered at 2× (1280 px; averaged down 2×2, as a viewer
 * would see it at the source size) against the 640 px source, overall and
 * per region.
 */
export function scoreCustomerEmblem(source: Uint8Array | Uint8ClampedArray, trace2x: Uint8Array | Uint8ClampedArray): Record<string, EmblemScore> {
  const w = CUSTOMER_EMBLEM_SIZE
  const h = CUSTOMER_EMBLEM_SIZE
  const n = w * h
  const traced = new Uint8ClampedArray(n * 4)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      for (let c = 0; c < 4; c++) {
        let s = 0
        for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) s += trace2x[((y * 2 + dy) * w * 2 + x * 2 + dx) * 4 + c]!
        traced[(y * w + x) * 4 + c] = Math.round(s / 4)
      }
  const srcRgb = toRgb(source, n)
  const trRgb = toRgb(traced, n)
  const srcLab = oklab(srcRgb, n)
  const trLab = oklab(trRgb, n)
  const srcBlurLab = oklab(blur(srcRgb, w, h, 0.7), n)
  const trBlurLab = oklab(blur(trRgb, w, h, 0.7), n)
  const mask = new Uint8Array(n)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if ((x - 320) ** 2 + (y - 320) ** 2 <= 318 ** 2) mask[y * w + x] = 1
  for (const [x0, y0, x1, y1] of OVERLAYS) for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) mask[y * w + x] = 0
  const sEdge = edgeMap(srcBlurLab, w, h, 0.1)
  const tEdge = edgeMap(trBlurLab, w, h, 0.1)
  const nearS = dilate(sEdge, w, h)
  const nearT = dilate(tEdge, w, h)
  // Thin dark lines: lightness valleys of the (lightly blurred) source.
  const valley = new Uint8Array(n)
  const L = (x: number, y: number) => srcBlurLab[(((y + h) % h) * w + ((x + w) % w)) * 3]!
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      for (const [dx, dy] of [[1, 0], [0, 1], [1, 1], [1, -1]] as const)
        for (const s of [1, 2]) {
          const c = L(x, y)
          if (L(x + s * dx, y + s * dy) - c > 0.12 && L(x - s * dx, y - s * dy) - c > 0.12) valley[y * w + x] = 1
        }
  const score = (inRegion: (x: number, y: number) => boolean): EmblemScore => {
    let de = 0
    let count = 0
    let sE = 0
    let sHit = 0
    let tE = 0
    let tHit = 0
    let lines = 0
    let kept = 0
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const p = y * w + x
        if (!mask[p] || !inRegion(x, y)) continue
        count++
        de += Math.hypot(trLab[p * 3]! - srcLab[p * 3]!, trLab[p * 3 + 1]! - srcLab[p * 3 + 1]!, trLab[p * 3 + 2]! - srcLab[p * 3 + 2]!)
        if (sEdge[p]) {
          sE++
          if (nearT[p]) sHit++
        }
        if (tEdge[p]) {
          tE++
          if (nearS[p]) tHit++
        }
        if (valley[p]) {
          lines++
          if (trLab[p * 3]! - srcBlurLab[p * 3]! < 0.08) kept++
        }
      }
    return {
      deltaE: (de / Math.max(1, count)) * 100,
      edgeRecall: sHit / Math.max(1, sE),
      edgePrecision: tHit / Math.max(1, tE),
      edgeLengthRatio: tE / Math.max(1, sE),
      linesKept: kept / Math.max(1, lines),
    }
  }
  const out: Record<string, EmblemScore> = { all: score(() => true) }
  for (const [name, boxes] of Object.entries(REGIONS)) out[name] = score((x, y) => boxes.some(([x0, y0, x1, y1]) => x >= x0 && x < x1 && y >= y0 && y < y1))
  return out
}
