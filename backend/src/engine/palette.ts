/**
 * Palette extraction and anti-aliasing-aware pixel labeling.
 *
 * The central problem of color tracing is deciding which colors are *real*
 * (ink/brand colors) and which are artifacts: anti-aliasing blends between two
 * shapes, JPEG ringing, sensor noise. Clustering every pixel equally (what
 * ImageTracer's quantizer does) gives artifact colors their own palette slots,
 * which then trace as thin halo rings around every shape.
 *
 * Here the palette is seeded only from "flat" pixels — those whose immediate
 * neighborhood is uniform — because edge pixels are exactly where blends live.
 * Labeling then treats edge pixels specially: if an edge pixel's color is a
 * mixture of the flat colors around it, it is assigned to the nearer of those
 * colors instead of whatever unrelated palette entry happens to sit closest in
 * color space.
 */
import { rgbToOklabInto } from './color'
import type { RgbaImage } from './raster'

export interface PaletteColor {
  /** Display color: mean of the source pixels (8-bit sRGB) — exact for flat art. */
  r: number
  g: number
  b: number
  /** OKLab centroid used for labeling. */
  L: number
  A: number
  B: number
  /** Number of flat source pixels behind this color. */
  weight: number
}

export interface PaletteOptions {
  /** OKLab distance under which two colors are considered the same ink. */
  mergeDistance: number
  /** Hard cap on palette size. */
  maxColors: number
  /** Clusters holding less than this fraction of flat pixels are dropped. */
  minClusterFraction: number
  /** Alpha below which a pixel counts as transparent (0-255). */
  alphaThreshold: number
}

export const TRANSPARENT_LABEL = -1

export interface LabelResult {
  palette: PaletteColor[]
  /** Per-pixel palette index, or TRANSPARENT_LABEL. */
  labels: Int32Array
}

// OKLab distance between 4-neighbours below which a pixel counts as "flat".
const FLATNESS_THRESHOLD = 0.035

interface Cluster {
  L: number
  A: number
  B: number
  weight: number
  sr: number
  sg: number
  sb: number
}

function dist2(aL: number, aA: number, aB: number, bL: number, bA: number, bB: number): number {
  const dL = aL - bL
  const dA = aA - bA
  const dB = aB - bB
  return dL * dL + dA * dA + dB * dB
}

/** Per-pixel OKLab (3 floats/pixel) — computed once, reused by every step. */
export function computeOklab(image: RgbaImage): Float32Array {
  const n = image.width * image.height
  const lab = new Float32Array(n * 3)
  const { data } = image
  // Cache by packed RGB: flat art has very few distinct colors, and even
  // photos repeat heavily, so this skips most cube roots.
  const cache = new Map<number, number>()
  for (let p = 0; p < n; p++) {
    const r = data[p * 4] ?? 0
    const g = data[p * 4 + 1] ?? 0
    const b = data[p * 4 + 2] ?? 0
    const key = (r << 16) | (g << 8) | b
    const cached = cache.get(key)
    if (cached !== undefined) {
      lab[p * 3] = lab[cached * 3] ?? 0
      lab[p * 3 + 1] = lab[cached * 3 + 1] ?? 0
      lab[p * 3 + 2] = lab[cached * 3 + 2] ?? 0
    } else {
      rgbToOklabInto(r, g, b, lab, p * 3)
      if (cache.size < 1 << 18) cache.set(key, p)
    }
  }
  return lab
}

/** Marks pixels whose OKLab distance to every opaque 4-neighbour is small. */
export function computeFlatMask(image: RgbaImage, lab: Float32Array, opaque: Uint8Array): Uint8Array {
  const { width: w, height: h } = image
  const flat = new Uint8Array(w * h)
  const t2 = FLATNESS_THRESHOLD * FLATNESS_THRESHOLD
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = y * w + x
      if (!opaque[p]) continue
      const L = lab[p * 3] ?? 0
      const A = lab[p * 3 + 1] ?? 0
      const B = lab[p * 3 + 2] ?? 0
      let isFlat = true
      const neighbours = [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, y > 0 ? p - w : -1, y < h - 1 ? p + w : -1]
      for (const q of neighbours) {
        if (q < 0) continue
        if (!opaque[q]) {
          isFlat = false
          break
        }
        if (dist2(L, A, B, lab[q * 3] ?? 0, lab[q * 3 + 1] ?? 0, lab[q * 3 + 2] ?? 0) > t2) {
          isFlat = false
          break
        }
      }
      if (isFlat) flat[p] = 1
    }
  }
  return flat
}

/**
 * Builds the palette: histogram flat pixels in fine OKLab bins, greedily
 * cluster bins (largest first) within mergeDistance, refine with weighted
 * k-means, drop negligible clusters, then Ward-merge down to maxColors.
 */
export function extractPalette(
  image: RgbaImage,
  lab: Float32Array,
  opaque: Uint8Array,
  flat: Uint8Array,
  options: PaletteOptions,
): PaletteColor[] {
  const n = image.width * image.height
  const { data } = image

  // If an image has (almost) no flat pixels — tiny icons, heavy noise — fall
  // back to using every opaque pixel so a palette still exists.
  let flatCount = 0
  let opaqueCount = 0
  for (let p = 0; p < n; p++) {
    if (flat[p]) flatCount++
    if (opaque[p]) opaqueCount++
  }
  if (opaqueCount === 0) return []
  const useAll = flatCount < Math.max(16, opaqueCount * 0.05)

  const BIN = 0.008
  const bins = new Map<number, Cluster>()
  for (let p = 0; p < n; p++) {
    if (!opaque[p] || (!useAll && !flat[p])) continue
    const L = lab[p * 3] ?? 0
    const A = lab[p * 3 + 1] ?? 0
    const B = lab[p * 3 + 2] ?? 0
    const key = Math.round(L / BIN) * 1_000_000 + (Math.round(A / BIN) + 500) * 1000 + (Math.round(B / BIN) + 500)
    let bin = bins.get(key)
    if (!bin) {
      bin = { L: 0, A: 0, B: 0, weight: 0, sr: 0, sg: 0, sb: 0 }
      bins.set(key, bin)
    }
    bin.L += L
    bin.A += A
    bin.B += B
    bin.sr += data[p * 4] ?? 0
    bin.sg += data[p * 4 + 1] ?? 0
    bin.sb += data[p * 4 + 2] ?? 0
    bin.weight++
  }

  const binList = Array.from(bins.values(), (bin) => ({
    ...bin,
    L: bin.L / bin.weight,
    A: bin.A / bin.weight,
    B: bin.B / bin.weight,
  })).sort((a, b) => b.weight - a.weight)

  const merge2 = options.mergeDistance * options.mergeDistance

  // Greedy seeding: most populous bins become cluster centers first, so a
  // brand color's exact value wins over its noisy neighbours.
  let clusters: Cluster[] = []
  for (const bin of binList) {
    let best = -1
    let bestD = Infinity
    for (let c = 0; c < clusters.length; c++) {
      const cl = clusters[c]!
      const d = dist2(bin.L, bin.A, bin.B, cl.L, cl.A, cl.B)
      if (d < bestD) {
        bestD = d
        best = c
      }
    }
    if (best >= 0 && bestD <= merge2) continue
    clusters.push({ L: bin.L, A: bin.A, B: bin.B, weight: 0, sr: 0, sg: 0, sb: 0 })
    if (clusters.length > 1024) break
  }

  // Weighted k-means refinement over bins.
  for (let iteration = 0; iteration < 6; iteration++) {
    const acc = clusters.map(() => ({ L: 0, A: 0, B: 0, weight: 0, sr: 0, sg: 0, sb: 0 }))
    for (const bin of binList) {
      let best = 0
      let bestD = Infinity
      for (let c = 0; c < clusters.length; c++) {
        const cl = clusters[c]!
        const d = dist2(bin.L, bin.A, bin.B, cl.L, cl.A, cl.B)
        if (d < bestD) {
          bestD = d
          best = c
        }
      }
      const a = acc[best]!
      a.L += bin.L * bin.weight
      a.A += bin.A * bin.weight
      a.B += bin.B * bin.weight
      a.weight += bin.weight
      a.sr += bin.sr
      a.sg += bin.sg
      a.sb += bin.sb
    }
    clusters = acc
      .filter((a) => a.weight > 0)
      .map((a) => ({ L: a.L / a.weight, A: a.A / a.weight, B: a.B / a.weight, weight: a.weight, sr: a.sr, sg: a.sg, sb: a.sb }))
  }

  // Drop negligible clusters (their pixels get relabeled to real colors).
  const totalWeight = clusters.reduce((sum, c) => sum + c.weight, 0)
  const minWeight = Math.max(1, totalWeight * options.minClusterFraction)
  const kept = clusters.filter((c) => c.weight >= minWeight)
  if (kept.length > 0) clusters = kept

  // Ward merge: repeatedly merge the pair whose merge adds the least
  // variance, until under the cap and no pair is closer than mergeDistance.
  for (;;) {
    let bestI = -1
    let bestJ = -1
    let bestCost = Infinity
    let bestD = Infinity
    for (let i = 0; i < clusters.length; i++) {
      for (let j = i + 1; j < clusters.length; j++) {
        const a = clusters[i]!
        const b = clusters[j]!
        const d = dist2(a.L, a.A, a.B, b.L, b.A, b.B)
        const cost = ((a.weight * b.weight) / (a.weight + b.weight)) * d
        if (cost < bestCost) {
          bestCost = cost
          bestI = i
          bestJ = j
          bestD = d
        }
      }
    }
    if (bestI < 0) break
    if (clusters.length <= options.maxColors && bestD > merge2) break
    const a = clusters[bestI]!
    const b = clusters[bestJ]!
    const weight = a.weight + b.weight
    clusters[bestI] = {
      L: (a.L * a.weight + b.L * b.weight) / weight,
      A: (a.A * a.weight + b.A * b.weight) / weight,
      B: (a.B * a.weight + b.B * b.weight) / weight,
      weight,
      sr: a.sr + b.sr,
      sg: a.sg + b.sg,
      sb: a.sb + b.sb,
    }
    clusters.splice(bestJ, 1)
  }

  // Blend clusters: a tiny cluster whose color sits on the line between two
  // much larger clusters is an anti-aliasing / chroma-subsampling artifact
  // (e.g. the 50% gray along module edges of a QR code), not an ink.
  const rgbOf = (c: Cluster): [number, number, number] => [c.sr / c.weight / 255, c.sg / c.weight / 255, c.sb / c.weight / 255]
  clusters = clusters.filter((c) => {
    const rgb = rgbOf(c)
    for (let i = 0; i < clusters.length; i++) {
      const a = clusters[i]!
      if (a === c || a.weight < c.weight * 12) continue
      for (let j = i + 1; j < clusters.length; j++) {
        const b = clusters[j]!
        if (b === c || b.weight < c.weight * 12) continue
        const { residual, t } = mixtureResidual(rgb, rgbOf(a), rgbOf(b))
        if (residual < 0.03 && t > 0.08 && t < 0.92) return false
      }
    }
    return true
  })

  return clusters
    .sort((a, b) => b.weight - a.weight)
    .map((c) => ({
      r: Math.round(c.sr / c.weight),
      g: Math.round(c.sg / c.weight),
      b: Math.round(c.sb / c.weight),
      L: c.L,
      A: c.A,
      B: c.B,
      weight: c.weight,
    }))
}

function nearestLabel(palette: PaletteColor[], L: number, A: number, B: number): number {
  let best = 0
  let bestD = Infinity
  for (let c = 0; c < palette.length; c++) {
    const col = palette[c]!
    const d = dist2(L, A, B, col.L, col.A, col.B)
    if (d < bestD) {
      bestD = d
      best = c
    }
  }
  return best
}

/**
 * Normalized gamma-encoded sRGB of a palette color, for mixture tests.
 * Anti-aliasing in browsers, design tools and most rasterizers blends in
 * gamma-encoded sRGB (not linear light), so that is the space in which an AA
 * pixel lies on the straight line between its two source colors.
 */
function linearOf(color: PaletteColor): [number, number, number] {
  return [color.r / 255, color.g / 255, color.b / 255]
}

function pixelRgb(data: Uint8ClampedArray, p: number): [number, number, number] {
  return [(data[p * 4] ?? 0) / 255, (data[p * 4 + 1] ?? 0) / 255, (data[p * 4 + 2] ?? 0) / 255]
}

/**
 * Distance (normalized sRGB) from pixel color p to the segment between colors a and
 * b, i.e. how well "p is an anti-aliased blend of a and b" explains it.
 */
function mixtureResidual(p: [number, number, number], a: [number, number, number], b: [number, number, number]): { residual: number; t: number } {
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  const dz = b[2] - a[2]
  const len2 = dx * dx + dy * dy + dz * dz
  let t = len2 > 0 ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy + (p[2] - a[2]) * dz) / len2 : 0
  t = Math.max(0, Math.min(1, t))
  const ex = a[0] + dx * t - p[0]
  const ey = a[1] + dy * t - p[1]
  const ez = a[2] + dz * t - p[2]
  return { residual: Math.sqrt(ex * ex + ey * ey + ez * ez), t }
}

/**
 * Assigns every opaque pixel a palette label. Flat pixels take their nearest
 * color. Edge pixels whose nearest color does not occur among the flat pixels
 * around them are tested as anti-aliasing blends of those surrounding colors;
 * if the blend explains them, they join the nearer side of the blend.
 */
export function labelPixels(
  image: RgbaImage,
  lab: Float32Array,
  opaque: Uint8Array,
  flat: Uint8Array,
  palette: PaletteColor[],
  windowRadius: number,
  localPreference: number,
  thinRadius = 0,
  thinPeakRadius = thinRadius,
): Int32Array {
  const { width: w, height: h, data } = image
  const n = w * h
  const labels = new Int32Array(n).fill(TRANSPARENT_LABEL)
  if (palette.length === 0) return labels
  // Per edge pixel: the two colors whose blend explains it and the coverage
  // of the second one (pairA = -1: no accepted blend). See preserveThinCoverage.
  const pairA = new Int32Array(n).fill(-1)
  const pairB = new Int32Array(n)
  const coverage = new Float32Array(n)

  // Cache nearest-label lookups by packed RGB.
  const cache = new Map<number, number>()
  for (let p = 0; p < n; p++) {
    if (!opaque[p]) continue
    const key = ((data[p * 4] ?? 0) << 16) | ((data[p * 4 + 1] ?? 0) << 8) | (data[p * 4 + 2] ?? 0)
    let label = cache.get(key)
    if (label === undefined) {
      label = nearestLabel(palette, lab[p * 3] ?? 0, lab[p * 3 + 1] ?? 0, lab[p * 3 + 2] ?? 0)
      cache.set(key, label)
    }
    labels[p] = label
  }

  if (palette.length < 2) return labels

  const linearPalette = palette.map(linearOf)
  const initial = labels.slice()
  const seen = new Int32Array(palette.length).fill(-1)
  const candidates: number[] = []
  // Flat pixels come in contiguous areas, so a sparse scan of large windows finds them.
  const step = windowRadius >= 6 ? 2 : 1

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = y * w + x
      if (!opaque[p] || flat[p]) continue
      const own = initial[p] ?? 0

      candidates.length = 0
      let ownIsNearby = false
      // Widen the search when the window holds no flat pixels at all (JPEG
      // ringing can leave a noisy band around text wider than the window).
      for (let radius = windowRadius; radius <= windowRadius * 4 && candidates.length === 0; radius *= 2) {
        const stride = radius >= 6 ? Math.max(step, Math.floor(radius / 4)) : step
        for (let dy = -radius; dy <= radius; dy += stride) {
          const ny = y + dy
          if (ny < 0 || ny >= h) continue
          for (let dx = -radius; dx <= radius; dx += stride) {
            const nx = x + dx
            if (nx < 0 || nx >= w) continue
            const q = ny * w + nx
            if (!flat[q]) continue
            const label = initial[q] ?? 0
            if (label === own) ownIsNearby = true
            if (seen[label] !== p) {
              seen[label] = p
              candidates.push(label)
            }
          }
        }
      }
      if (candidates.length === 0) continue

      const pixel = pixelRgb(data, p)
      const ownResidual = Math.hypot(
        pixel[0] - linearPalette[own]![0],
        pixel[1] - linearPalette[own]![1],
        pixel[2] - linearPalette[own]![2],
      )
      let bestResidual = Infinity
      let bestLabel = own
      let bestA = -1
      let bestB = -1
      let bestT = 0
      for (let i = 0; i < candidates.length; i++) {
        for (let j = i + 1; j < candidates.length; j++) {
          const a = candidates[i]!
          const b = candidates[j]!
          const { residual, t } = mixtureResidual(pixel, linearPalette[a]!, linearPalette[b]!)
          if (residual < bestResidual) {
            bestResidual = residual
            bestLabel = t < 0.5 ? a : b
            bestA = a
            bestB = b
            bestT = t
          }
        }
      }
      // Only one flat color in reach (the other side of the edge is a thin or
      // noisy stroke with no flat pixels): test blends of that color with
      // every palette color as the unseen partner.
      if (candidates.length === 1 && !ownIsNearby) {
        const a = candidates[0]!
        for (let b = 0; b < palette.length; b++) {
          if (b === a) continue
          const { residual, t } = mixtureResidual(pixel, linearPalette[a]!, linearPalette[b]!)
          if (residual < bestResidual) {
            bestResidual = residual
            bestLabel = t < 0.5 ? a : b
            bestA = a
            bestB = b
            bestT = t
          }
        }
      }
      // Anti-aliasing coverage is linear in sRGB, so when a blend of two
      // surrounding colors explains the pixel, the blend parameter decides
      // which side of the true edge it lies on (t < 0.5 = more than half
      // covered by the first color). Nearest-color in OKLab would not: its
      // lightness is non-linear, so dark shapes would shrink by a fraction
      // of a pixel. When the pixel's own color isn't around, the blend must
      // also clearly beat that color.
      // A color that occurs nowhere nearby must beat the local blend outright;
      // JPEG chroma bleed can push a pixel well off the exact blend line.
      if (ownIsNearby ? bestResidual < 0.06 && bestResidual <= ownResidual + 0.02 : bestResidual < 0.15 && bestResidual < ownResidual) {
        labels[p] = bestLabel
        if (bestA >= 0) {
          pairA[p] = bestA
          pairB[p] = bestB
          coverage[p] = bestT
        }
        continue
      }
      if (ownIsNearby) continue
      // …or when a surrounding color is itself close: ringing, noise and
      // soft edges shouldn't spawn islands of a color that isn't there.
      const L = lab[p * 3] ?? 0
      const A = lab[p * 3 + 1] ?? 0
      const B = lab[p * 3 + 2] ?? 0
      let nearestLocal = own
      let nearestLocalD = Infinity
      for (const c of candidates) {
        const col = palette[c]!
        const d = dist2(L, A, B, col.L, col.A, col.B)
        if (d < nearestLocalD) {
          nearestLocalD = d
          nearestLocal = c
        }
      }
      if (nearestLocalD < localPreference * localPreference) labels[p] = nearestLocal
    }
  }

  if (thinRadius > 0) preserveThinCoverage(labels, pairA, pairB, coverage, w, h, thinRadius, thinPeakRadius)
  return labels
}

/** Pixels with less coverage than this are never promoted (noise). */
const THIN_MIN_COVERAGE = 0.15
/** Features whose coverage reaches this anywhere nearby are wide, not thin. */
const THIN_MAX_PEAK = 0.85

/**
 * Coverage-preserving labeling for thin features.
 *
 * Deciding each anti-aliased pixel by its own coverage (> 50% = the stroke)
 * is right for edges between wide areas, but loses thin features: a 1 px
 * line straddling two pixels is ~50% in each, and a 0.5 px hairline never
 * reaches 50% anywhere, so hairlines, small-text stems and thin gaps break up
 * or vanish. Instead, for a pixel blended between colors A and B, look at a
 * small window: the summed coverage S of the color the pixel is NOT labeled
 * with says how many pixels of that color the window should contain. If
 * fewer than S pixels in the window have higher coverage than this one, this
 * pixel belongs to that color too.
 *
 * Pure pixels add 1 (or 0) to both sides of the comparison, so wide shapes
 * are unaffected: along a straight edge between wide areas this reproduces
 * the 50% rule exactly. Only where the coverage budget is not met — thin
 * strokes and thin gaps — do pixels change, and a feature of total width w
 * keeps a core about w wide, centered where the ink is.
 */
function preserveThinCoverage(
  labels: Int32Array,
  pairA: Int32Array,
  pairB: Int32Array,
  coverage: Float32Array,
  w: number,
  h: number,
  radius: number,
  peakRadius: number,
): void {
  const peakRadius2 = peakRadius * peakRadius
  // Decisions are collected and applied afterwards, so every pixel is judged
  // against the same (pre-pass) labels regardless of scan order.
  const promote: number[] = []
  const decided = labels
  // Coverage of color x (paired against y) at q, or -1 if q is unrelated.
  const coverageOf = (q: number, x: number, y: number): number => {
    const a = pairA[q]!
    if (a >= 0) {
      const b = pairB[q]!
      if (a === x && b === y) return 1 - coverage[q]!
      if (a === y && b === x) return coverage[q]!
      return -1
    }
    const label = decided[q]!
    if (label === x) return 1
    if (label === y) return 0
    return -1
  }
  for (let y0 = 0; y0 < h; y0++) {
    for (let x0 = 0; x0 < w; x0++) {
      const p = y0 * w + x0
      const a = pairA[p]!
      if (a < 0) continue
      const b = pairB[p]!
      const current = decided[p]!
      let other: number
      let own: number
      if (current === a) {
        other = b
        own = a
      } else if (current === b) {
        other = a
        own = b
      } else continue
      const cp = coverageOf(p, other, own)
      if (cp < THIN_MIN_COVERAGE || cp >= 0.5) continue
      let sum = 0
      let above = 0
      let peak = 0
      for (let dy = -radius; dy <= radius; dy++) {
        const yy = y0 + dy
        if (yy < 0 || yy >= h) continue
        for (let dx = -radius; dx <= radius; dx++) {
          const xx = x0 + dx
          if (xx < 0 || xx >= w) continue
          const c = coverageOf(yy * w + xx, other, own)
          if (c < 0) continue
          sum += c
          if (c > cp) above++
          if (c > peak && dx * dx + dy * dy <= peakRadius2) peak = c
        }
      }
      // A nearly pure pixel of that color nearby means a wide shape, where the
      // per-pixel 50% rule is already right; only thin features need this.
      if (peak < THIN_MAX_PEAK && above + 0.5 < sum) promote.push(p, other)
    }
  }
  for (let i = 0; i < promote.length; i += 2) labels[promote[i]!] = promote[i + 1]!
}

/**
 * Second palette pass for thin features. Strokes a pixel or two wide (small
 * text, hairlines, fine outlines) have no flat pixels at all, so the first
 * pass never sees their color and they would be swallowed by the background.
 * Here, edge pixels that are NOT explained as a blend of the flat colors
 * around them are collected and clustered; clusters with enough support
 * become additional palette entries. Their display color is taken from the
 * purest member pixels (farthest from the existing palette), since even the
 * stroke's center pixels are partly blended with the background.
 */
export function extractDetailColors(
  image: RgbaImage,
  lab: Float32Array,
  opaque: Uint8Array,
  flat: Uint8Array,
  palette: PaletteColor[],
  options: { mergeDistance: number; minPixels: number; maxColors: number },
): PaletteColor[] {
  if (palette.length === 0 || palette.length >= options.maxColors) return []
  const { width: w, height: h, data } = image
  const linearPalette = palette.map(linearOf)
  const minD2 = (options.mergeDistance * 1.6) ** 2
  const seen = new Int32Array(palette.length).fill(-1)
  const detail: { p: number; d: number }[] = []
  const nearestCache = new Map<number, number>()

  const nearestIndex = (q: number): number => {
    const key = ((data[q * 4] ?? 0) << 16) | ((data[q * 4 + 1] ?? 0) << 8) | (data[q * 4 + 2] ?? 0)
    let label = nearestCache.get(key)
    if (label === undefined) {
      label = nearestLabel(palette, lab[q * 3] ?? 0, lab[q * 3 + 1] ?? 0, lab[q * 3 + 2] ?? 0)
      nearestCache.set(key, label)
    }
    return label
  }

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = y * w + x
      if (!opaque[p] || flat[p]) continue
      const L = lab[p * 3] ?? 0
      const A = lab[p * 3 + 1] ?? 0
      const B = lab[p * 3 + 2] ?? 0
      const own = palette[nearestIndex(p)]!
      const d2 = dist2(L, A, B, own.L, own.A, own.B)
      if (d2 < minD2) continue

      // Colors around it (any pixel within 2, by nearest label).
      const local: number[] = []
      for (let dy = -2; dy <= 2; dy++) {
        const ny = y + dy
        if (ny < 0 || ny >= h) continue
        for (let dx = -2; dx <= 2; dx++) {
          const nx = x + dx
          if (nx < 0 || nx >= w || (dx === 0 && dy === 0)) continue
          const q = ny * w + nx
          if (!opaque[q]) continue
          const label = nearestIndex(q)
          if (seen[label] !== p) {
            seen[label] = p
            local.push(label)
          }
        }
      }
      const pixel = pixelRgb(data, p)
      let explained = false
      for (let i = 0; i < local.length && !explained; i++) {
        for (let j = i + 1; j < local.length; j++) {
          if (mixtureResidual(pixel, linearPalette[local[i]!]!, linearPalette[local[j]!]!).residual < 0.035) {
            explained = true
            break
          }
        }
      }
      if (!explained) detail.push({ p, d: Math.sqrt(d2) })
    }
  }
  if (detail.length < options.minPixels) return []

  // Keep only spatially coherent detail: thin strokes and small text form
  // connected runs of such pixels, whereas pixels at 3-color junctions (a
  // blend no two-color mix explains) come in isolated clumps of 1-4.
  const isDetail = new Uint8Array(w * h)
  for (const { p } of detail) isDetail[p] = 1
  const componentSize = new Int32Array(w * h)
  const stack: number[] = []
  const members: number[] = []
  for (const { p: seed } of detail) {
    if (componentSize[seed]) continue
    members.length = 0
    stack.push(seed)
    componentSize[seed] = -1
    while (stack.length > 0) {
      const q = stack.pop()!
      members.push(q)
      const qx = q % w
      const qy = (q - qx) / w
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = qx + dx
          const ny = qy + dy
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue
          const r = ny * w + nx
          if (isDetail[r] && !componentSize[r]) {
            componentSize[r] = -1
            stack.push(r)
          }
        }
      }
    }
    for (const q of members) componentSize[q] = members.length
  }
  const coherent = detail.filter(({ p }) => componentSize[p]! >= 6)
  detail.length = 0
  detail.push(...coherent)
  if (detail.length < options.minPixels) return []

  // Greedy clustering, strongest (most distinct) pixels first.
  detail.sort((a, b) => b.d - a.d)
  const merge2 = (options.mergeDistance * 1.5) ** 2
  const clusters: { L: number; A: number; B: number; members: number[] }[] = []
  for (const { p } of detail) {
    const L = lab[p * 3] ?? 0
    const A = lab[p * 3 + 1] ?? 0
    const B = lab[p * 3 + 2] ?? 0
    let best = -1
    let bestD = Infinity
    for (let c = 0; c < clusters.length; c++) {
      const cl = clusters[c]!
      const d = dist2(L, A, B, cl.L, cl.A, cl.B)
      if (d < bestD) {
        bestD = d
        best = c
      }
    }
    if (best >= 0 && bestD <= merge2) clusters[best]!.members.push(p)
    else if (clusters.length < 64) clusters.push({ L, A, B, members: [p] })
  }

  const added: PaletteColor[] = []
  for (const cluster of clusters) {
    if (cluster.members.length < options.minPixels) continue
    // Members are already ordered most-distinct first: average the purest 40%.
    const top = cluster.members.slice(0, Math.max(1, Math.ceil(cluster.members.length * 0.4)))
    let r = 0
    let g = 0
    let b = 0
    let L = 0
    let A = 0
    let B = 0
    for (const p of top) {
      r += data[p * 4] ?? 0
      g += data[p * 4 + 1] ?? 0
      b += data[p * 4 + 2] ?? 0
      L += lab[p * 3] ?? 0
      A += lab[p * 3 + 1] ?? 0
      B += lab[p * 3 + 2] ?? 0
    }
    const k = top.length
    const candidate: PaletteColor = { r: r / k, g: g / k, b: b / k, L: L / k, A: A / k, B: B / k, weight: cluster.members.length }
    const known = [...palette, ...added]
    const tooClose = known.some((c) => dist2(c.L, c.A, c.B, candidate.L, candidate.A, candidate.B) < options.mergeDistance ** 2)
    // Clusters are visited most-distinct first, so a tint of an already
    // accepted detail color (its blend with the background) is rejected here.
    const rgb: [number, number, number] = [candidate.r / 255, candidate.g / 255, candidate.b / 255]
    let isBlend = false
    for (let i = 0; i < known.length && !isBlend; i++) {
      for (let j = i + 1; j < known.length; j++) {
        if (mixtureResidual(rgb, linearOf(known[i]!), linearOf(known[j]!)).residual < 0.045) {
          isBlend = true
          break
        }
      }
    }
    if (!tooClose && !isBlend) added.push({ ...candidate, r: Math.round(candidate.r), g: Math.round(candidate.g), b: Math.round(candidate.b) })
    if (palette.length + added.length >= options.maxColors) break
  }

  // The order check above misses a tint accepted *before* its pure color
  // (small italic text: the 80% ink/20% paper blend cluster can come first).
  // Such a tint steals the stroke's edge pixels and is later merged into the
  // background, breaking the glyphs, so drop any detail color that a later
  // accepted color explains as a blend.
  const known = [...palette, ...added]
  return added.filter((color, k) => {
    const self = palette.length + k
    const rgb: [number, number, number] = [color.r / 255, color.g / 255, color.b / 255]
    for (let i = palette.length + k + 1; i < known.length; i++) {
      for (let j = 0; j < known.length; j++) {
        if (j === i || j === self) continue
        const { residual, t } = mixtureResidual(rgb, linearOf(known[i]!), linearOf(known[j]!))
        if (residual < 0.045 && t > 0.05 && t < 0.95) return false
      }
    }
    return true
  })
}
