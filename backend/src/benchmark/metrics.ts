/**
 * Render-and-diff metrics. Both images are RGBA at the same size; colors are
 * composited over white, then compared in OKLab.
 */
import { rgbToOklabInto } from '../engine/color'

export interface ImageDiffMetrics {
  /** Mean OKLab ΔE ×100 over all pixels (≈1 is a just-noticeable difference). */
  meanDeltaE: number
  /** % of pixels with ΔE > 0.10 — visibly wrong color or misplaced edge. */
  badPixelPct: number
  /** Mean edge displacement in *source* pixels: bad-pixel area / ground-truth edge length. */
  boundaryError: number
  /** Mean |alpha difference| in % (transparency fidelity). */
  alphaErrorPct: number
  /** Pixels opaque in the truth but see-through in the trace (gaps/seams), per 10k opaque pixels. */
  gapsPer10k: number
}

function compositeLab(rgba: Uint8Array | Uint8ClampedArray, n: number): Float32Array {
  const lab = new Float32Array(n * 3)
  const cache = new Map<number, number>()
  for (let p = 0; p < n; p++) {
    const a = (rgba[p * 4 + 3] ?? 0) / 255
    const r = Math.round((rgba[p * 4] ?? 0) * a + 255 * (1 - a))
    const g = Math.round((rgba[p * 4 + 1] ?? 0) * a + 255 * (1 - a))
    const b = Math.round((rgba[p * 4 + 2] ?? 0) * a + 255 * (1 - a))
    const key = (r << 16) | (g << 8) | b
    const hit = cache.get(key)
    if (hit !== undefined) {
      lab[p * 3] = lab[hit * 3]!
      lab[p * 3 + 1] = lab[hit * 3 + 1]!
      lab[p * 3 + 2] = lab[hit * 3 + 2]!
    } else {
      rgbToOklabInto(r, g, b, lab, p * 3)
      cache.set(key, p)
    }
  }
  return lab
}

export function compareImages(
  truth: Uint8Array | Uint8ClampedArray,
  traced: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
  evalScale: number,
): ImageDiffMetrics {
  const n = width * height
  const a = compositeLab(truth, n)
  const b = compositeLab(traced, n)
  let sumDe = 0
  let bad = 0
  let alphaErr = 0
  let opaque = 0
  let gaps = 0
  for (let p = 0; p < n; p++) {
    const de = Math.hypot(a[p * 3]! - b[p * 3]!, a[p * 3 + 1]! - b[p * 3 + 1]!, a[p * 3 + 2]! - b[p * 3 + 2]!)
    sumDe += de
    if (de > 0.1) bad++
    const ta = truth[p * 4 + 3] ?? 0
    const ba = traced[p * 4 + 3] ?? 0
    alphaErr += Math.abs(ta - ba)
    if (ta === 255) {
      opaque++
      // Gaps: see-through pixels deep inside opaque truth (not edge offsets).
      const x = p % width
      const y = (p - x) / width
      if (ba < 200 && x > 1 && y > 1 && x < width - 2 && y < height - 2) {
        let interior = true
        for (let dy = -2; dy <= 2 && interior; dy++) {
          for (let dx = -2; dx <= 2; dx++) {
            if ((truth[(p + dy * width + dx) * 4 + 3] ?? 0) !== 255) {
              interior = false
              break
            }
          }
        }
        if (interior) gaps++
      }
    }
  }

  // Ground-truth edge length (in eval pixels): pixels whose right/down
  // neighbour differs clearly.
  let edgePixels = 0
  for (let y = 0; y < height - 1; y++) {
    for (let x = 0; x < width - 1; x++) {
      const p = y * width + x
      const r = p + 1
      const d = p + width
      const dr = Math.hypot(a[p * 3]! - a[r * 3]!, a[p * 3 + 1]! - a[r * 3 + 1]!, a[p * 3 + 2]! - a[r * 3 + 2]!)
      const dd = Math.hypot(a[p * 3]! - a[d * 3]!, a[p * 3 + 1]! - a[d * 3 + 1]!, a[p * 3 + 2]! - a[d * 3 + 2]!)
      if (dr > 0.1 || dd > 0.1) edgePixels++
    }
  }

  return {
    meanDeltaE: (sumDe / n) * 100,
    badPixelPct: (bad / n) * 100,
    boundaryError: edgePixels > 0 ? bad / edgePixels / evalScale : 0,
    alphaErrorPct: (alphaErr / n / 255) * 100,
    gapsPer10k: opaque > 0 ? (gaps / opaque) * 10_000 : 0,
  }
}

const ARITY: Record<string, number> = { m: 2, l: 2, h: 1, v: 1, c: 6, s: 4, q: 4, t: 2, a: 7, z: 0 }

export interface SvgStructure {
  bytes: number
  pathCount: number
  /** Drawing segments (lines + curves) across all paths — the "node count" designers see. */
  segments: number
  curves: number
}

export function measureSvgStructure(svg: string): SvgStructure {
  let segments = 0
  let curves = 0
  let pathCount = 0
  for (const match of svg.matchAll(/<path\b[^>]*\sd="([^"]*)"/g)) {
    pathCount++
    const d = match[1] ?? ''
    const tokens = d.match(/[a-zA-Z]|-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/g) ?? []
    let command = ''
    let args = 0
    for (const token of tokens) {
      if (/^[a-zA-Z]$/.test(token)) {
        command = token.toLowerCase()
        args = 0
        if (command === 'z') continue
        continue
      }
      args++
      const arity = ARITY[command] ?? 2
      if (arity > 0 && args % arity === 0) {
        if (command === 'm' && args === 2) continue
        segments++
        if (command === 'c' || command === 's' || command === 'q' || command === 't' || command === 'a') curves++
      }
    }
  }
  return { bytes: new TextEncoder().encode(svg).byteLength, pathCount, segments, curves }
}
