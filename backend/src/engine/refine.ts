/**
 * Hierarchical shading refinement (Professional).
 *
 * The global palette is deliberately coarse (mergeDistance ≈ 2.5 JND): a
 * finer one also picks up anti-aliasing blends and JPEG ringing around thin
 * strokes as "inks", which then break hairlines and hatching into dashes. But
 * coarse levels posterize shading — a metallic rim, a shaded ribbon or a glow
 * — into a few hard bands, and merge a dark gradient end with whatever
 * similar color touches it.
 *
 * So the segmentation is refined in a second level, inside regions only:
 * each region whose interior colors spread smoothly along one color
 * direction (shading) is re-quantized along that direction into levels `step`
 * apart. Region boundaries, thin features and text keep the coarse labels;
 * interior pixels choose a level by the mean color around them, and the edge
 * band of the region (anti-aliasing, where pixels blend with the neighbour)
 * takes the level of the interior next to it, so no halo bands appear along
 * edges. Noise is not shading: specks of foreign colors are left out, and a
 * region whose spread does not survive local averaging is not refined.
 * Refined pixels all get new palette entries (appended after the palette's
 * first `palette.length` colors), so callers can tell levels from the coarse
 * labels; regions labeled beyond the palette (gradient fills) are skipped.
 */
import { interiorDistance } from './gradients'
import type { OklabSource, LabelMap, PaletteColor } from './palette'
import { TRANSPARENT_LABEL } from './palette'
import type { RgbaImage } from './raster'
import { checkpoint } from './memoryCheckpoint'

export interface ShadingRefineOptions {
  /** OKLab distance between refined levels. */
  step: number
  /** Pixels this close (working px) to a region boundary follow the interior. */
  margin: number
  /** Regions with fewer interior pixels are left alone. */
  minInterior: number
  /** A refined level needs at least this many interior pixels. */
  minLevel: number
  /** Cap on palette entries added. */
  maxNewColors: number
  /** Cap on levels created (each is at least one new region). */
  maxLevels: number
  /** Pixels farther than this (OKLab) from their region's color are foreign specks, not shading. */
  maxColorDistance: number
  /** Window radius (working px) over which a pixel's color is averaged to pick its level. */
  smoothRadius: number
}

const MAX_LEVELS = 48
const STATS = 10 // n, ΣL, ΣA, ΣB, ΣLL, ΣLA, ΣLB, ΣAA, ΣAB, ΣBB

/** Number of regions refined (diagnostics). */
export function refineShading(
  labels: LabelMap,
  ids: Int32Array,
  regionCount: number,
  regionLabels: Int32Array,
  image: RgbaImage,
  lab: OklabSource,
  palette: PaletteColor[],
  options: ShadingRefineOptions,
): number {
  const { width: w, height: h, data } = image
  const n = w * h
  const basePaletteSize = palette.length
  const margin = Math.max(0, Math.round(options.margin))
  // Interior: away from the region's boundary, and away from specks of other
  // colors merged into it by speckle cleanup (noise, JPEG blocks, dropped
  // detail): those keep their own colors, and so does the blended halo
  // around them, which would come back as levels. Like the edge band, they
  // take the level around them instead.
  const foreign2 = options.maxColorDistance * options.maxColorDistance
  const isForeign = (p: number) => {
    const own = palette[regionLabels[ids[p]!]!]
    if (!own) return true
    const dL = lab.L(p) - own.L
    const dA = lab.A(p) - own.A
    const dB = lab.B(p) - own.B
    return dL * dL + dA * dA + dB * dB > foreign2
  }
  const distance = interiorDistance(ids, w, h, margin + 1, isForeign)
  const interior = (p: number) => distance[p]! > margin
  // 1. Color moments of each region's interior.
  const stats = new Float64Array(regionCount * STATS)
  for (let p = 0; p < n; p++) {
    if (!interior(p)) continue
    const r = ids[p]!
    const L = lab.L(p)
    const A = lab.A(p)
    const B = lab.B(p)
    const o = r * STATS
    stats[o] = stats[o]! + 1
    stats[o + 1] = stats[o + 1]! + L
    stats[o + 2] = stats[o + 2]! + A
    stats[o + 3] = stats[o + 3]! + B
    stats[o + 4] = stats[o + 4]! + L * L
    stats[o + 5] = stats[o + 5]! + L * A
    stats[o + 6] = stats[o + 6]! + L * B
    stats[o + 7] = stats[o + 7]! + A * A
    stats[o + 8] = stats[o + 8]! + A * B
    stats[o + 9] = stats[o + 9]! + B * B
  }

  // 2. Shaded regions: principal color direction with a spread of several levels.
  interface Candidate {
    region: number
    mean: [number, number, number]
    axis: [number, number, number]
    lo: number
    bins: number
    /** First accumulator slot (bins × 7: n, R, G, B, L, A, B). */
    offset: number
  }
  const candidates: Candidate[] = []
  const candidateOf = new Int32Array(regionCount).fill(-1)
  let slots = 0
  const order = Array.from({ length: regionCount }, (_, r) => r)
    .filter((r) => stats[r * STATS]! >= options.minInterior && regionLabels[r] !== TRANSPARENT_LABEL && regionLabels[r]! < basePaletteSize)
    .sort((a, b) => stats[b * STATS]! - stats[a * STATS]!)
  for (const r of order) {
    const o = r * STATS
    const k = stats[o]!
    const m: [number, number, number] = [stats[o + 1]! / k, stats[o + 2]! / k, stats[o + 3]! / k]
    const c = [
      stats[o + 4]! / k - m[0] * m[0],
      stats[o + 5]! / k - m[0] * m[1],
      stats[o + 6]! / k - m[0] * m[2],
      stats[o + 7]! / k - m[1] * m[1],
      stats[o + 8]! / k - m[1] * m[2],
      stats[o + 9]! / k - m[2] * m[2],
    ] as const
    // Power iteration on the 3×3 covariance.
    let v: [number, number, number] = [1, 0.3, 0.2]
    let lambda = 0
    for (let it = 0; it < 12; it++) {
      const x = c[0] * v[0] + c[1] * v[1] + c[2] * v[2]
      const y = c[1] * v[0] + c[3] * v[1] + c[4] * v[2]
      const z = c[2] * v[0] + c[4] * v[1] + c[5] * v[2]
      lambda = Math.hypot(x, y, z)
      if (lambda < 1e-12) break
      v = [x / lambda, y / lambda, z / lambda]
    }
    const sigma = Math.sqrt(Math.max(0, lambda))
    // Noise and flat inks spread far less than two levels; shading more.
    if (4 * sigma < 2 * options.step) continue
    const lo = -3 * sigma
    const bins = Math.min(MAX_LEVELS, Math.max(2, Math.ceil((6 * sigma) / options.step)))
    candidateOf[r] = candidates.length
    candidates.push({ region: r, mean: m, axis: v, lo, bins, offset: slots })
    slots += bins
  }
  if (candidates.length === 0) return 0

  // A pixel's level follows the mean color of its window (interior pixels
  // of the same region, about one source pixel around it): shading is smooth,
  // whereas noise and the halos of merged specks would otherwise come back as
  // islands of the extreme levels.
  const radius = Math.max(1, Math.round(options.smoothRadius))
  const project = (cand: Candidate, p: number) =>
    (lab.L(p) - cand.mean[0]) * cand.axis[0] + (lab.A(p) - cand.mean[1]) * cand.axis[1] + (lab.B(p) - cand.mean[2]) * cand.axis[2]
  const smoothT = (cand: Candidate, p: number): number => {
    const x = p % w
    const y = (p - x) / w
    const region = ids[p]!
    let sum = 0
    let count = 0
    for (let dy = -radius; dy <= radius; dy++) {
      const yy = y + dy
      if (yy < 0 || yy >= h) continue
      for (let dx = -radius; dx <= radius; dx++) {
        const xx = x + dx
        if (xx < 0 || xx >= w) continue
        const q = yy * w + xx
        if (ids[q] !== region || !interior(q)) continue
        sum += project(cand, q)
        count++
      }
    }
    return count > 0 ? sum / count : project(cand, p)
  }
  const binAt = (cand: Candidate, t: number): number => {
    const b = Math.floor(((t - cand.lo) / (-2 * cand.lo)) * cand.bins)
    return b < 0 ? 0 : b >= cand.bins ? cand.bins - 1 : b
  }
  const binOf = (cand: Candidate, p: number) => binAt(cand, smoothT(cand, p))

  // 3. Interior colors per level, and the spread of the smoothed colors:
  //    averaging barely changes shading but shrinks noise, which is what
  //    still spreads a flat area that only noise made look shaded.
  const acc = new Float64Array(slots * 7)
  const smoothMoments = new Float64Array(candidates.length * 3)
  for (let p = 0; p < n; p++) {
    if (!interior(p)) continue
    const k = candidateOf[ids[p]!]!
    if (k < 0) continue
    const cand = candidates[k]!
    const t = smoothT(cand, p)
    smoothMoments[k * 3] = smoothMoments[k * 3]! + 1
    smoothMoments[k * 3 + 1] = smoothMoments[k * 3 + 1]! + t
    smoothMoments[k * 3 + 2] = smoothMoments[k * 3 + 2]! + t * t
    const o = (cand.offset + binAt(cand, t)) * 7
    acc[o] = acc[o]! + 1
    acc[o + 1] = acc[o + 1]! + data[p * 4]!
    acc[o + 2] = acc[o + 2]! + data[p * 4 + 1]!
    acc[o + 3] = acc[o + 3]! + data[p * 4 + 2]!
    acc[o + 4] = acc[o + 4]! + lab.L(p)
    acc[o + 5] = acc[o + 5]! + lab.A(p)
    acc[o + 6] = acc[o + 6]! + lab.B(p)
  }

  // 4. Levels: sparse bins join their neighbours; each level becomes a palette
  //    color (shared between regions when the same within step / 3).
  const binLabel = new Int32Array(slots).fill(-1)
  const shared = new Map<number, number>()
  const q = options.step / 3
  const keyOf = (L: number, A: number, B: number) => Math.round(L / q) * 1_000_000 + (Math.round(A / q) + 500) * 1000 + (Math.round(B / q) + 500)
  const labelFor = (sum: Float64Array): number => {
    const k = sum[0]!
    const L = sum[4]! / k
    const A = sum[5]! / k
    const B = sum[6]! / k
    const key = keyOf(L, A, B)
    const known = shared.get(key)
    if (known !== undefined) return known
    if (palette.length - basePaletteSize >= options.maxNewColors) return -1
    palette.push({ r: Math.round(sum[1]! / k), g: Math.round(sum[2]! / k), b: Math.round(sum[3]! / k), L, A, B, weight: k })
    shared.set(key, palette.length - 1)
    return palette.length - 1
  }
  let refined = 0
  const group = new Float64Array(7)
  let levelsLeft = options.maxLevels
  for (let k = 0; k < candidates.length; k++) {
    const cand = candidates[k]!
    const m = smoothMoments[k * 3]!
    const smoothSigma = m > 0 ? Math.sqrt(Math.max(0, smoothMoments[k * 3 + 2]! / m - (smoothMoments[k * 3 + 1]! / m) ** 2)) : 0
    if (4 * smoothSigma < 2 * options.step) continue
    // Sweep bins, closing a level once it holds minLevel pixels.
    const levels: { from: number; to: number; sum: Float64Array }[] = []
    let from = 0
    group.fill(0)
    for (let b = 0; b < cand.bins; b++) {
      const o = (cand.offset + b) * 7
      for (let j = 0; j < 7; j++) group[j] = group[j]! + acc[o + j]!
      if (group[0]! >= options.minLevel) {
        levels.push({ from, to: b, sum: group.slice() })
        group.fill(0)
        from = b + 1
      }
    }
    if (group[0]! > 0 || from < cand.bins) {
      const last = levels[levels.length - 1]
      if (last) {
        for (let j = 0; j < 7; j++) last.sum[j] = last.sum[j]! + group[j]!
        last.to = cand.bins - 1
      }
    }
    // Neighbouring levels closer than most of a step are one level that
    // straddles a bin edge (or a noise-widened spread), not shading.
    for (let i = 0; i + 1 < levels.length; ) {
      const a = levels[i]!.sum
      const b = levels[i + 1]!.sum
      const d = Math.hypot(a[4]! / a[0]! - b[4]! / b[0]!, a[5]! / a[0]! - b[5]! / b[0]!, a[6]! / a[0]! - b[6]! / b[0]!)
      if (d >= 0.75 * options.step) {
        i++
        continue
      }
      for (let j = 0; j < 7; j++) a[j] = a[j]! + b[j]!
      levels[i]!.to = levels[i + 1]!.to
      levels.splice(i + 1, 1)
    }
    if (levels.length < 2) continue
    if (levelsLeft < levels.length) continue
    levelsLeft -= levels.length
    const assigned = levels.map((level) => labelFor(level.sum))
    if (assigned.some((label) => label < 0)) continue
    levels.forEach((level, i) => {
      for (let b = level.from; b <= level.to; b++) binLabel[cand.offset + b] = assigned[i]!
    })
    refined++
  }
  if (refined === 0) return 0

  // 5. Interior pixels take their level (marked 255 in `distance`).
  const INTERIOR = 255
  const refinedAt = (p: number) => {
    const k = candidateOf[ids[p]!]!
    return k >= 0 && binLabel[candidates[k]!.offset]! >= 0
  }
  for (let p = 0; p < n; p++) {
    if (!refinedAt(p)) continue
    if (interior(p)) {
      const cand = candidates[candidateOf[ids[p]!]!]!
      labels[p] = binLabel[cand.offset + binOf(cand, p)]!
      distance[p] = INTERIOR
    } else distance[p] = 0
  }
  // 6. The edge band (and foreign specks) take the level of the nearest
  //    interior, one pixel layer per pass: pass i marks what it assigns
  //    255 - i and only follows pixels assigned in earlier passes, so a level
  //    never runs along the band.
  const passes = Math.min(64, margin + radius + 2)
  for (let pass = 1; pass <= passes; pass++) {
    const earlier = INTERIOR - pass + 1
    let changed = false
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const p = y * w + x
        if (distance[p]! >= earlier || !refinedAt(p)) continue
        const region = ids[p]!
        let from = -1
        if (x > 0 && distance[p - 1]! >= earlier && ids[p - 1] === region) from = p - 1
        else if (x < w - 1 && distance[p + 1]! >= earlier && ids[p + 1] === region) from = p + 1
        else if (y > 0 && distance[p - w]! >= earlier && ids[p - w] === region) from = p - w
        else if (y < h - 1 && distance[p + w]! >= earlier && ids[p + w] === region) from = p + w
        if (from < 0) continue
        labels[p] = labels[from]!
        distance[p] = INTERIOR - pass
        changed = true
      }
    }
    if (!changed) break
  }
  checkpoint('refineShading')
  const DONE = INTERIOR - passes
  // Thin parts with no interior nearby: their own color's level.
  for (let p = 0; p < n; p++) {
    if (distance[p]! >= DONE || !refinedAt(p)) continue
    const cand = candidates[candidateOf[ids[p]!]!]!
    labels[p] = binLabel[cand.offset + binOf(cand, p)]!
  }
  return refined
}
