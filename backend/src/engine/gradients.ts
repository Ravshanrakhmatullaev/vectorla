/**
 * Gradient reconstruction.
 *
 * Palette-based tracing turns a smooth gradient into a stack of flat bands
 * ("posterization"). Here, bands are recognized and merged back into one
 * region filled with a fitted SVG <linearGradient>:
 *
 *  1. Every region gets a least-squares linear color model
 *     c(x, y) = a + b·x + d·y per sRGB channel. The fit is kept as additive
 *     sufficient statistics, so the fit of any union of regions is the fit of
 *     the summed statistics — merges are evaluated in O(1).
 *  2. Adjacent regions merge only if each has a real internal color ramp (a
 *     flat logo shape has none) AND the union is still explained by one
 *     linear ramp with a small residual. A genuine edge between two colors is
 *     a step no linear model fits, so real shapes never merge.
 *  3. Each merged group gets a gradient vector along its dominant color
 *     direction and multi-stop colors sampled along it (simplified to the
 *     fewest stops that stay within tolerance), so non-linear ramps and
 *     multi-color gradients are reproduced too.
 */
import type { RgbaImage } from './raster'

const STAT_SIZE = 18 // n, Sx, Sy, Sxx, Sxy, Syy, then per channel: Sc, Scx, Scy, Scc

export interface GradientStop {
  offset: number
  r: number
  g: number
  b: number
}

export type GradientFill = LinearGradientFill | RadialGradientFill

export interface RadialGradientFill {
  kind: 'radial'
  /** Center and radius in working coordinates; stop offsets are r / radius. */
  cx: number
  cy: number
  r: number
  stops: GradientStop[]
  mean: { r: number; g: number; b: number }
}

export interface LinearGradientFill {
  kind: 'linear'
  /** Gradient vector in working coordinates. */
  x1: number
  y1: number
  x2: number
  y2: number
  stops: GradientStop[]
  /** Mean color, used for ordering/fallbacks. */
  mean: { r: number; g: number; b: number }
}

export interface GradientOptions {
  /** Max RMS residual (sRGB 0-1) for a group to count as one linear ramp. */
  maxResidual: number
  /** Minimum color change (sRGB 0-1) across a group for it to be a gradient. */
  minRamp: number
  /** Minimum internal ramp (sRGB 0-1) of each merged region — flat shapes have ~0. */
  minRegionRamp: number
  /** Regions smaller than this (working px) are never gradient seeds. */
  minArea: number
  /**
   * Pixels closer than this (working px) to a region boundary are left out of
   * the fits: anti-aliased edge pixels blend with the neighbour and would
   * inflate the residual of every region.
   */
  edgeMargin: number
  /**
   * Regions join a gradient only across borders whose mean pixel step
   * (sRGB 0-1, largest channel) is at most this: a posterization cut, not a
   * real edge. Undefined: any border.
   */
  maxBoundaryStep?: number
  /** Search radial gradient centers (searchRadialCenters) instead of using the bands' centroid. */
  radialCenterSearch?: boolean
}

/**
 * Chessboard distance (in pixels) to the nearest pixel of a different region,
 * capped at `cap`. With `isEdge`, those pixels count as boundary too.
 */
export function interiorDistance(regionIds: Int32Array, w: number, h: number, cap: number, isEdge?: (p: number) => boolean): Uint8Array {
  const d = new Uint8Array(w * h)
  const limit = Math.min(255, cap)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = y * w + x
      const r = regionIds[p]!
      const edge =
        (isEdge !== undefined && isEdge(p)) ||
        (x > 0 && regionIds[p - 1] !== r) ||
        (x < w - 1 && regionIds[p + 1] !== r) ||
        (y > 0 && regionIds[p - w] !== r) ||
        (y < h - 1 && regionIds[p + w] !== r)
      d[p] = edge ? 0 : limit
    }
  }
  // Two-pass chamfer (8-neighbourhood, unit weights).
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = y * w + x
      let v = d[p]!
      if (x > 0) v = Math.min(v, d[p - 1]! + 1)
      if (y > 0) {
        v = Math.min(v, d[p - w]! + 1)
        if (x > 0) v = Math.min(v, d[p - w - 1]! + 1)
        if (x < w - 1) v = Math.min(v, d[p - w + 1]! + 1)
      }
      d[p] = v
    }
  }
  for (let y = h - 1; y >= 0; y--) {
    for (let x = w - 1; x >= 0; x--) {
      const p = y * w + x
      let v = d[p]!
      if (x < w - 1) v = Math.min(v, d[p + 1]! + 1)
      if (y < h - 1) {
        v = Math.min(v, d[p + w]! + 1)
        if (x < w - 1) v = Math.min(v, d[p + w + 1]! + 1)
        if (x > 0) v = Math.min(v, d[p + w - 1]! + 1)
      }
      d[p] = v
    }
  }
  return d
}

interface Fit {
  mean: [number, number, number]
  rms: number
  /** Unit direction of strongest color change. */
  ux: number
  uy: number
  /** Color change per working pixel along (ux, uy), per channel. */
  slope: [number, number, number]
  /** Approximate color span across the region along the direction (|slope| · 4σ). */
  ramp: number
  cx: number
  cy: number
}

function solve3(m: number[], v: number[]): [number, number, number] | null {
  const [a, b, c, d, e, f, g, h, i] = m as [number, number, number, number, number, number, number, number, number]
  const det = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g)
  if (Math.abs(det) < 1e-12) return null
  const [p, q, r] = v as [number, number, number]
  return [
    (p * (e * i - f * h) - b * (q * i - f * r) + c * (q * h - e * r)) / det,
    (a * (q * i - f * r) - p * (d * i - f * g) + c * (d * r - q * g)) / det,
    (a * (e * r - q * h) - b * (d * r - q * g) + p * (d * h - e * g)) / det,
  ]
}

/** Fits the linear color model from sufficient statistics (coordinates pre-centered by the caller's origin). */
function fitStats(s: Float64Array, o: number): Fit | null {
  const n = s[o]!
  if (n < 6) return null
  const Sx = s[o + 1]!
  const Sy = s[o + 2]!
  const Sxx = s[o + 3]!
  const Sxy = s[o + 4]!
  const Syy = s[o + 5]!
  const cx = Sx / n
  const cy = Sy / n
  const M = [n, Sx, Sy, Sx, Sxx, Sxy, Sy, Sxy, Syy]
  const betas: [number, number, number][] = []
  let rss = 0
  const mean: [number, number, number] = [0, 0, 0]
  for (let ch = 0; ch < 3; ch++) {
    const k = o + 6 + ch * 4
    const Sc = s[k]!
    const Scx = s[k + 1]!
    const Scy = s[k + 2]!
    const Scc = s[k + 3]!
    mean[ch] = Sc / n
    const beta = solve3(M, [Sc, Scx, Scy]) ?? [Sc / n, 0, 0]
    betas.push(beta)
    rss += Math.max(0, Scc - (beta[0] * Sc + beta[1] * Scx + beta[2] * Scy))
  }
  // Dominant direction: principal eigenvector of Σ_ch (b, d)(b, d)ᵀ.
  let a11 = 0
  let a12 = 0
  let a22 = 0
  for (const [, b, d] of betas) {
    a11 += b * b
    a12 += b * d
    a22 += d * d
  }
  const tr = a11 + a22
  const disc = Math.sqrt(Math.max(0, (a11 - a22) * (a11 - a22) + 4 * a12 * a12))
  const lambda = (tr + disc) / 2
  let ux = a12
  let uy = lambda - a11
  if (Math.hypot(ux, uy) < 1e-12) {
    ux = lambda - a22
    uy = a12
  }
  const len = Math.hypot(ux, uy)
  if (len < 1e-12) {
    ux = 1
    uy = 0
  } else {
    ux /= len
    uy /= len
  }
  const slope: [number, number, number] = [0, 0, 0]
  for (let ch = 0; ch < 3; ch++) slope[ch] = betas[ch]![1] * ux + betas[ch]![2] * uy
  // Spatial variance along the direction.
  const vxx = Sxx / n - cx * cx
  const vxy = Sxy / n - cx * cy
  const vyy = Syy / n - cy * cy
  const varT = Math.max(0, ux * ux * vxx + 2 * ux * uy * vxy + uy * uy * vyy)
  const ramp = Math.hypot(slope[0], slope[1], slope[2]) * 4 * Math.sqrt(varT)
  return { mean, rms: Math.sqrt(rss / (3 * n)), ux, uy, slope, ramp, cx, cy }
}

export interface GradientResult {
  /** Region id -> gradient group index (-1 = not part of a gradient). */
  groupOfRegion: Int32Array
  fills: GradientFill[]
}

/**
 * Finds gradient groups among `regionCount` regions (ids per pixel in
 * `regionIds`); transparent regions are passed as `excluded`.
 */
export function detectGradients(
  image: RgbaImage,
  regionIds: Int32Array,
  regionCount: number,
  excluded: (region: number) => boolean,
  options: GradientOptions,
): GradientResult {
  const { width: w, height: h, data } = image
  const originX = w / 2
  const originY = h / 2
  const stats = new Float64Array(regionCount * STAT_SIZE)
  // Mean color over ALL pixels (including edges) — for sliver absorption.
  const fullColor = new Float64Array(regionCount * 4)
  const margin = Math.max(0, Math.round(options.edgeMargin))
  const distance = interiorDistance(regionIds, w, h, margin + 1)
  for (let y = 0; y < h; y++) {
    const yy = y + 0.5 - originY
    for (let x = 0; x < w; x++) {
      const p = y * w + x
      const fr = regionIds[p]! * 4
      fullColor[fr] = fullColor[fr]! + (data[p * 4] ?? 0) / 255
      fullColor[fr + 1] = fullColor[fr + 1]! + (data[p * 4 + 1] ?? 0) / 255
      fullColor[fr + 2] = fullColor[fr + 2]! + (data[p * 4 + 2] ?? 0) / 255
      fullColor[fr + 3] = fullColor[fr + 3]! + 1
      if (distance[p]! <= margin) continue
      const region = regionIds[p]!
      const o = region * STAT_SIZE
      const xx = x + 0.5 - originX
      stats[o] = stats[o]! + 1
      stats[o + 1] = stats[o + 1]! + xx
      stats[o + 2] = stats[o + 2]! + yy
      stats[o + 3] = stats[o + 3]! + xx * xx
      stats[o + 4] = stats[o + 4]! + xx * yy
      stats[o + 5] = stats[o + 5]! + yy * yy
      for (let ch = 0; ch < 3; ch++) {
        const c = (data[p * 4 + ch] ?? 0) / 255
        const k = o + 6 + ch * 4
        stats[k] = stats[k]! + c
        stats[k + 1] = stats[k + 1]! + c * xx
        stats[k + 2] = stats[k + 2]! + c * yy
        stats[k + 3] = stats[k + 3]! + c * c
      }
    }
  }

  const fits: (Fit | null)[] = []
  for (let r = 0; r < regionCount; r++) fits.push(excluded(r) ? null : fitStats(stats, r * STAT_SIZE))
  const hasRamp = (r: number) => {
    const fit = fits[r]
    return fit !== null && fit !== undefined && stats[r * STAT_SIZE]! >= options.minArea && fit.ramp >= options.minRegionRamp && fit.rms <= options.maxResidual
  }

  // Adjacent region pairs with shared border length, and the mean pixel
  // step across that border: where posterization cut a smooth ramp into
  // bands, neighbouring pixels across the cut differ by the ramp's slope only;
  // across a real edge (an outline, a shape on a background) they jump.
  const pairIndex = new Map<number, number>()
  const pairLength: number[] = []
  const pairStep: number[] = []
  const addPair = (p: number, q: number) => {
    const a = regionIds[p]!
    const b = regionIds[q]!
    if (a === b) return
    const key = a < b ? a * regionCount + b : b * regionCount + a
    let i = pairIndex.get(key)
    if (i === undefined) {
      i = pairLength.length
      pairIndex.set(key, i)
      pairLength.push(0)
      pairStep.push(0)
    }
    pairLength[i] = pairLength[i]! + 1
    pairStep[i] =
      pairStep[i]! +
      Math.max(Math.abs((data[p * 4] ?? 0) - (data[q * 4] ?? 0)), Math.abs((data[p * 4 + 1] ?? 0) - (data[q * 4 + 1] ?? 0)), Math.abs((data[p * 4 + 2] ?? 0) - (data[q * 4 + 2] ?? 0))) / 255
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = y * w + x
      if (x + 1 < w) addPair(p, p + 1)
      if (y + 1 < h) addPair(p, p + w)
    }
  }
  const maxStep = options.maxBoundaryStep ?? Infinity
  const allPairs = Array.from(pairIndex.entries())
    .map(([key, i]) => ({ a: Math.floor(key / regionCount), b: key % regionCount, length: pairLength[i]!, weak: pairStep[i]! / pairLength[i]! <= maxStep }))
    .sort((p, q) => q.length - p.length)
  const pairs = allPairs.filter(({ a, b, weak }) => weak && hasRamp(a) && hasRamp(b))
  // Radial candidates need internal color variation, not a linear fit: a
  // ring-shaped band of a radial gradient is not a linear ramp.
  const varies = (r: number) => {
    if (excluded(r)) return false
    const o = r * STAT_SIZE
    const n = stats[o]!
    if (n < options.minArea) return false
    let variance = 0
    for (let ch = 0; ch < 3; ch++) {
      const mean = stats[o + 6 + ch * 4]! / n
      variance += Math.max(0, stats[o + 9 + ch * 4]! / n - mean * mean)
    }
    return Math.sqrt(variance) >= options.minRegionRamp / 4
  }
  const radialPairs = allPairs.filter(({ a, b, weak }) => weak && varies(a) && varies(b))

  // --- Radial gradients -----------------------------------------------------
  // Concentric bands (a glow, a spherical highlight) are not one linear ramp.
  // Clusters of adjacent ramp regions are tested against a radial model
  // c = a + k·|p − center| (center = the cluster's centroid), and taken when
  // it explains the colors well and clearly better than a linear ramp.
  const radial = detectRadialClusters(radialPairs, stats, regionCount, regionIds, w, h, originX, originY, data, distance, margin, options)
  const inRadial = new Uint8Array(regionCount)
  for (const cluster of radial) for (const r of cluster.members) inRadial[r] = 1

  // Union-find over regions with summed statistics per root.
  const parent = new Int32Array(regionCount)
  for (let i = 0; i < regionCount; i++) parent[i] = i
  const find = (x: number): number => {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]!]!
      x = parent[x]!
    }
    return x
  }
  const groupStats = stats.slice()
  const scratch = new Float64Array(STAT_SIZE)
  for (const { a, b } of pairs) {
    if (inRadial[a] || inRadial[b]) continue
    const ra = find(a)
    const rb = find(b)
    if (ra === rb) continue
    for (let k = 0; k < STAT_SIZE; k++) scratch[k] = groupStats[ra * STAT_SIZE + k]! + groupStats[rb * STAT_SIZE + k]!
    const union = fitStats(scratch, 0)
    const fa = fitStats(groupStats, ra * STAT_SIZE)
    const fb = fitStats(groupStats, rb * STAT_SIZE)
    if (!union || !fa || !fb) continue
    // One linear ramp must explain both parts about as well as each alone.
    if (union.rms > options.maxResidual || union.rms > Math.max(fa.rms, fb.rms) * 1.6 + 0.006) continue
    parent[rb] = ra
    groupStats.set(scratch, ra * STAT_SIZE)
  }

  // Collect groups: 2+ regions, or a single region that is itself a strong ramp.
  const members = new Map<number, number[]>()
  for (let r = 0; r < regionCount; r++) {
    if (!hasRamp(r) || inRadial[r]) continue
    const root = find(r)
    const list = members.get(root)
    if (list) list.push(r)
    else members.set(root, [r])
  }
  const groupOfRegion = new Int32Array(regionCount).fill(-1)
  const radialFills: GradientFill[] = radial.map((cluster, g) => {
    for (const r of cluster.members) groupOfRegion[r] = g
    return cluster.fill
  })
  const firstLinear = radialFills.length
  const groupRoots: number[] = []
  for (const [root, list] of members) {
    const fit = fitStats(groupStats, root * STAT_SIZE)
    if (!fit || fit.ramp < options.minRamp) continue
    if (list.length < 2 && fit.ramp < options.minRamp * 2) continue
    const g = groupRoots.length
    groupRoots.push(root)
    for (const r of list) groupOfRegion[r] = firstLinear + g
  }
  absorbSlivers(groupOfRegion, regionCount, allPairs, stats, fullColor, excluded, radialFills, groupRoots.map((root) => fitStats(groupStats, root * STAT_SIZE)!), firstLinear)
  if (groupRoots.length === 0) return { groupOfRegion, fills: radialFills }

  // Sample colors along each group's gradient direction.
  const fitsByGroup = groupRoots.map((root) => fitStats(groupStats, root * STAT_SIZE)!)
  const tMin = new Float64Array(groupRoots.length).fill(Infinity)
  const tMax = new Float64Array(groupRoots.length).fill(-Infinity)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const g = groupOfRegion[regionIds[y * w + x]!]! - firstLinear
      if (g < 0) continue
      const fit = fitsByGroup[g]!
      const t = (x + 0.5 - originX) * fit.ux + (y + 0.5 - originY) * fit.uy
      if (t < tMin[g]!) tMin[g] = t
      if (t > tMax[g]!) tMax[g] = t
    }
  }
  const BINS = 24
  const bins = new Float64Array(groupRoots.length * BINS * 4)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = y * w + x
      const g = groupOfRegion[regionIds[p]!]! - firstLinear
      if (g < 0 || distance[p]! <= margin) continue
      const fit = fitsByGroup[g]!
      const t = (x + 0.5 - originX) * fit.ux + (y + 0.5 - originY) * fit.uy
      const span = Math.max(1e-9, tMax[g]! - tMin[g]!)
      const bin = Math.min(BINS - 1, Math.floor(((t - tMin[g]!) / span) * BINS))
      const o = (g * BINS + bin) * 4
      bins[o] = bins[o]! + (data[p * 4] ?? 0)
      bins[o + 1] = bins[o + 1]! + (data[p * 4 + 1] ?? 0)
      bins[o + 2] = bins[o + 2]! + (data[p * 4 + 2] ?? 0)
      bins[o + 3] = bins[o + 3]! + 1
    }
  }

  const linearFills: LinearGradientFill[] = fitsByGroup.map((fit, g) => {
    const samples: GradientStop[] = []
    for (let bin = 0; bin < BINS; bin++) {
      const o = (g * BINS + bin) * 4
      const count = bins[o + 3]!
      if (count < 4) continue
      samples.push({ offset: (bin + 0.5) / BINS, r: bins[o]! / count, g: bins[o + 1]! / count, b: bins[o + 2]! / count })
    }
    // Extrapolate the outermost samples to the ends of the vector with the
    // fitted slope (bins near the ends are thin and partly edge-excluded).
    const spanT = Math.max(1e-9, tMax[g]! - tMin[g]!)
    const extrapolate = (sample: GradientStop, offset: number): GradientStop => {
      const dt = (offset - sample.offset) * spanT
      const clamp = (v: number) => Math.max(0, Math.min(255, v))
      return {
        offset,
        r: clamp(sample.r + fit.slope[0] * 255 * dt),
        g: clamp(sample.g + fit.slope[1] * 255 * dt),
        b: clamp(sample.b + fit.slope[2] * 255 * dt),
      }
    }
    if (samples.length > 0) {
      samples.unshift(extrapolate(samples[0]!, 0))
      samples.push(extrapolate(samples[samples.length - 1]!, 1))
    }
    const stops = simplifyStops(samples, 3.0)
    const t0 = tMin[g]!
    const t1 = tMax[g]!
    return {
      kind: 'linear' as const,
      x1: originX + fit.ux * t0,
      y1: originY + fit.uy * t0,
      x2: originX + fit.ux * t1,
      y2: originY + fit.uy * t1,
      stops,
      mean: { r: fit.mean[0] * 255, g: fit.mean[1] * 255, b: fit.mean[2] * 255 },
    }
  })
  return { groupOfRegion, fills: [...radialFills, ...linearFills] }
}

interface RadialCluster {
  members: number[]
  fill: RadialGradientFill
}

function detectRadialClusters(
  pairs: { a: number; b: number }[],
  stats: Float64Array,
  regionCount: number,
  regionIds: Int32Array,
  w: number,
  h: number,
  originX: number,
  originY: number,
  data: Uint8ClampedArray,
  distance: Uint8Array,
  margin: number,
  options: GradientOptions,
): RadialCluster[] {
  const parent = new Int32Array(regionCount)
  for (let i = 0; i < regionCount; i++) parent[i] = i
  const find = (x: number): number => {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]!]!
      x = parent[x]!
    }
    return x
  }
  const inPairs = new Uint8Array(regionCount)
  for (const { a, b } of pairs) {
    inPairs[a] = 1
    inPairs[b] = 1
    const ra = find(a)
    const rb = find(b)
    if (ra !== rb) parent[rb] = ra
  }
  const clusters = new Map<number, number[]>()
  for (let r = 0; r < regionCount; r++) {
    if (!inPairs[r]) continue
    const root = find(r)
    const list = clusters.get(root)
    if (list) list.push(r)
    else clusters.set(root, [r])
  }
  const candidates = Array.from(clusters.values()).filter((list) => list.length >= 2)
  if (candidates.length === 0) return []

  const clusterOf = new Int32Array(regionCount).fill(-1)
  const centers: { cx: number; cy: number; linearRms: number; ux: number; uy: number }[] = []
  const summed = new Float64Array(STAT_SIZE)
  candidates.forEach((list, k) => {
    summed.fill(0)
    for (const r of list) {
      clusterOf[r] = k
      for (let j = 0; j < STAT_SIZE; j++) summed[j] = summed[j]! + stats[r * STAT_SIZE + j]!
    }
    const linear = fitStats(summed, 0)
    centers.push({ cx: summed[1]! / summed[0]!, cy: summed[2]! / summed[0]!, linearRms: linear ? linear.rms : Infinity, ux: linear ? linear.ux : 1, uy: linear ? linear.uy : 0 })
  })
  const profileRms = options.radialCenterSearch ? searchRadialCenters(candidates, centers, clusterOf, stats, regionIds, w, h, originX, originY, data, distance, margin) : null

  // Per cluster: n, Sr, Srr, rMax, then per channel Sc, Scr, Scc.
  const R = 4 + 9
  const acc = new Float64Array(candidates.length * R)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = y * w + x
      const k = clusterOf[regionIds[p]!]!
      if (k < 0) continue
      const c = centers[k]!
      const radius = Math.hypot(x + 0.5 - originX - c.cx, y + 0.5 - originY - c.cy)
      const o = k * R
      if (radius > acc[o + 3]!) acc[o + 3] = radius
      if (distance[p]! <= margin) continue
      acc[o] = acc[o]! + 1
      acc[o + 1] = acc[o + 1]! + radius
      acc[o + 2] = acc[o + 2]! + radius * radius
      for (let ch = 0; ch < 3; ch++) {
        const v = (data[p * 4 + ch] ?? 0) / 255
        const q = o + 4 + ch * 3
        acc[q] = acc[q]! + v
        acc[q + 1] = acc[q + 1]! + v * radius
        acc[q + 2] = acc[q + 2]! + v * v
      }
    }
  }

  const accepted: { k: number; slope: [number, number, number]; intercept: [number, number, number] }[] = []
  candidates.forEach((_, k) => {
    const o = k * R
    const n = acc[o]!
    if (n < 16) return
    const Sr = acc[o + 1]!
    const Srr = acc[o + 2]!
    const denom = n * Srr - Sr * Sr
    if (denom <= 1e-9) return
    let rss = 0
    const slope: [number, number, number] = [0, 0, 0]
    const intercept: [number, number, number] = [0, 0, 0]
    for (let ch = 0; ch < 3; ch++) {
      const q = o + 4 + ch * 3
      const Sc = acc[q]!
      const Scr = acc[q + 1]!
      const Scc = acc[q + 2]!
      const kk = (n * Scr - Sr * Sc) / denom
      const a = (Sc - kk * Sr) / n
      slope[ch] = kk
      intercept[ch] = a
      rss += Math.max(0, Scc - a * Sc - kk * Scr)
    }
    const rms = Math.sqrt(rss / (3 * n))
    const ramp = Math.hypot(slope[0], slope[1], slope[2]) * acc[o + 3]!
    // With a searched center, the fit is judged by its radial color profile
    // (piecewise, like the emitted stops): multi-stop glows are not linear in r.
    const fitRms = profileRms ? profileRms[k]! : rms
    if (fitRms <= options.maxResidual && fitRms < centers[k]!.linearRms * 0.7 && ramp >= options.minRamp) {
      accepted.push({ k, slope, intercept })
    }
  })
  if (accepted.length === 0) return []

  // Colors along the radius (interior pixels), then fewest stops within tolerance.
  const BINS = 24
  const indexOf = new Int32Array(candidates.length).fill(-1)
  accepted.forEach(({ k }, i) => (indexOf[k] = i))
  const bins = new Float64Array(accepted.length * BINS * 4)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = y * w + x
      const k = clusterOf[regionIds[p]!]!
      if (k < 0 || indexOf[k]! < 0 || distance[p]! <= margin) continue
      const c = centers[k]!
      const radius = Math.hypot(x + 0.5 - originX - c.cx, y + 0.5 - originY - c.cy)
      const bin = Math.min(BINS - 1, Math.floor((radius / Math.max(1e-9, acc[k * R + 3]!)) * BINS))
      const o = (indexOf[k]! * BINS + bin) * 4
      bins[o] = bins[o]! + (data[p * 4] ?? 0)
      bins[o + 1] = bins[o + 1]! + (data[p * 4 + 1] ?? 0)
      bins[o + 2] = bins[o + 2]! + (data[p * 4 + 2] ?? 0)
      bins[o + 3] = bins[o + 3]! + 1
    }
  }
  return accepted.map(({ k, slope, intercept }, i) => {
    const rMax = acc[k * R + 3]!
    const samples: GradientStop[] = []
    for (let bin = 0; bin < BINS; bin++) {
      const o = (i * BINS + bin) * 4
      const count = bins[o + 3]!
      if (count < 4) continue
      samples.push({ offset: (bin + 0.5) / BINS, r: bins[o]! / count, g: bins[o + 1]! / count, b: bins[o + 2]! / count })
    }
    const at = (offset: number): GradientStop => {
      const radius = offset * rMax
      const clamp = (v: number) => Math.max(0, Math.min(255, v * 255))
      return { offset, r: clamp(intercept[0] + slope[0] * radius), g: clamp(intercept[1] + slope[1] * radius), b: clamp(intercept[2] + slope[2] * radius) }
    }
    if (samples.length === 0 || samples[0]!.offset > 0) samples.unshift(at(0))
    samples.push(at(1))
    const c = centers[k]!
    const mean = samples.reduce((m, s) => ({ r: m.r + s.r / samples.length, g: m.g + s.g / samples.length, b: m.b + s.b / samples.length }), { r: 0, g: 0, b: 0 })
    return {
      members: candidates[k]!,
      fill: { kind: 'radial' as const, cx: originX + c.cx, cy: originY + c.cy, r: rMax, stops: simplifyStops(samples, 3.0), mean },
    }
  })
}

const PROFILE_BINS = 16
const MAX_PROFILE_SAMPLES = 3000
/** A radial profile must rise from 10% to 90% of its color change over at least this share of its bins. */
const MIN_RISE_WIDTH = 0.35

/**
 * Radial centers by search. A glow's center is rarely the centroid of its
 * visible bands (a shield clips a radial fill off-center, a highlight sits
 * up and left), and with the wrong center no radial model fits. For each
 * candidate cluster, a sample of its interior pixels is fitted with a
 * piecewise color profile over the distance from a center (PROFILE_BINS
 * bins, as the emitted stops are), and the center minimizing the residual is
 * found by a coarse grid then a halving local search around the centroid.
 * Updates `centers` in place (center, and linearRms lowered to the residual
 * of the same piecewise profile along the linear direction); returns each
 * cluster's radial profile RMS (sRGB 0-1).
 */
function searchRadialCenters(
  candidates: number[][],
  centers: { cx: number; cy: number; linearRms: number; ux: number; uy: number }[],
  clusterOf: Int32Array,
  stats: Float64Array,
  regionIds: Int32Array,
  w: number,
  h: number,
  originX: number,
  originY: number,
  data: Uint8ClampedArray,
  distance: Uint8Array,
  margin: number,
): Float64Array {
  const result = new Float64Array(candidates.length).fill(Infinity)
  const stride = new Int32Array(candidates.length)
  const samples: Float32Array[] = []
  const filled = new Int32Array(candidates.length)
  const seen = new Int32Array(candidates.length)
  candidates.forEach((list, k) => {
    let n = 0
    for (const r of list) n += stats[r * STAT_SIZE]!
    stride[k] = Math.max(1, Math.floor(n / MAX_PROFILE_SAMPLES))
    samples.push(new Float32Array((Math.floor(n / stride[k]!) + 1) * 5))
  })
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = y * w + x
      const k = clusterOf[regionIds[p]!]!
      if (k < 0 || distance[p]! <= margin) continue
      if (seen[k]!++ % stride[k]! !== 0) continue
      const buf = samples[k]!
      const o = filled[k]! * 5
      if (o + 5 > buf.length) continue
      buf[o] = x + 0.5 - originX
      buf[o + 1] = y + 0.5 - originY
      buf[o + 2] = (data[p * 4] ?? 0) / 255
      buf[o + 3] = (data[p * 4 + 1] ?? 0) / 255
      buf[o + 4] = (data[p * 4 + 2] ?? 0) / 255
      filled[k] = filled[k]! + 1
    }
  }
  const sums = new Float64Array(PROFILE_BINS * 7)
  const radii = new Float64Array(MAX_PROFILE_SAMPLES * 2 + 2)
  candidates.forEach((_, k) => {
    const count = filled[k]!
    if (count < 16) return
    const buf = samples[k]!
    const r = count > radii.length ? new Float64Array(count) : radii
    // Residual of a piecewise color profile over the coordinate in r[].
    const profile = (): number => {
      let rMin = Infinity
      let rMax = -Infinity
      for (let i = 0; i < count; i++) {
        if (r[i]! < rMin) rMin = r[i]!
        if (r[i]! > rMax) rMax = r[i]!
      }
      const span = Math.max(1e-9, rMax - rMin)
      sums.fill(0)
      for (let i = 0; i < count; i++) {
        const b = Math.min(PROFILE_BINS - 1, Math.floor(((r[i]! - rMin) / span) * PROFILE_BINS)) * 7
        sums[b] = sums[b]! + 1
        for (let ch = 0; ch < 3; ch++) {
          const v = buf[i * 5 + 2 + ch]!
          sums[b + 1 + ch] = sums[b + 1 + ch]! + v
          sums[b + 4 + ch] = sums[b + 4 + ch]! + v * v
        }
      }
      let rss = 0
      for (let b = 0; b < PROFILE_BINS; b++) {
        const o = b * 7
        const m = sums[o]!
        if (m === 0) continue
        for (let ch = 0; ch < 3; ch++) rss += Math.max(0, sums[o + 4 + ch]! - (sums[o + 1 + ch]! * sums[o + 1 + ch]!) / m)
      }
      return Math.sqrt(rss / (3 * count))
    }
    // Width of the profile's rise, for the bins `profile()` left in `sums`:
    // the share of the bins between the first reaching 10% and the first
    // reaching 90% of the net color change (center to rim). A glow changes
    // across most of its radius; a flat disk whose blurred rim reads as
    // concentric bands changes within a bin or two. Noise in the flat parts
    // adds steps but no net change, so it does not widen the rise.
    const riseWidth = (): number => {
      const means: number[][] = []
      for (let b = 0; b < PROFILE_BINS; b++) {
        const m = sums[b * 7]!
        if (m > 0) means.push([0, 1, 2].map((ch) => sums[b * 7 + 1 + ch]! / m))
      }
      if (means.length < 3) return 0
      const first = means[0]!
      const last = means[means.length - 1]!
      const d = [last[0]! - first[0]!, last[1]! - first[1]!, last[2]! - first[2]!]
      const len2 = d[0]! * d[0]! + d[1]! * d[1]! + d[2]! * d[2]!
      if (len2 < 1e-6) return 1
      const t = means.map((m) => ((m[0]! - first[0]!) * d[0]! + (m[1]! - first[1]!) * d[1]! + (m[2]! - first[2]!) * d[2]!) / len2)
      const i10 = t.findIndex((v) => v >= 0.1)
      const i90 = t.findIndex((v) => v >= 0.9)
      return (i90 - i10 + 1) / means.length
    }
    const evaluate = (cx: number, cy: number): number => {
      for (let i = 0; i < count; i++) r[i] = Math.hypot(buf[i * 5]! - cx, buf[i * 5 + 1]! - cy)
      return profile()
    }
    // Spatial extent of the cluster sets the search range and steps.
    let mx = 0
    let my = 0
    for (let i = 0; i < count; i++) {
      mx += buf[i * 5]!
      my += buf[i * 5 + 1]!
    }
    mx /= count
    my /= count
    let spread = 0
    for (let i = 0; i < count; i++) spread += (buf[i * 5]! - mx) ** 2 + (buf[i * 5 + 1]! - my) ** 2
    spread = Math.sqrt(spread / count)
    const atCentroid = evaluate(centers[k]!.cx, centers[k]!.cy)
    let bestX = centers[k]!.cx
    let bestY = centers[k]!.cy
    let best = atCentroid
    const range = 1.5 * spread
    for (let gy = -3; gy <= 3; gy++) {
      for (let gx = -3; gx <= 3; gx++) {
        const cx = mx + (gx / 3) * range
        const cy = my + (gy / 3) * range
        const e = evaluate(cx, cy)
        if (e < best) {
          best = e
          bestX = cx
          bestY = cy
        }
      }
    }
    for (let step = range / 3; step > spread / 64; step /= 2) {
      let moved = true
      while (moved) {
        moved = false
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
          const e = evaluate(bestX + dx * step, bestY + dy * step)
          if (e < best - 1e-6) {
            best = e
            bestX += dx * step
            bestY += dy * step
            moved = true
          }
        }
      }
    }
    // A far center turns circles into near-parallel lines, so the radial
    // profile also fits a multi-stop *linear* ramp; it only counts as radial
    // if it clearly beats the same piecewise profile along the linear direction.
    const c = centers[k]!
    for (let i = 0; i < count; i++) r[i] = buf[i * 5]! * c.ux + buf[i * 5 + 1]! * c.uy
    c.linearRms = Math.min(c.linearRms, profile())
    // A centered glow keeps its centroid: sampling noise alone moves the optimum a little.
    if (best < atCentroid * 0.9) {
      c.cx = bestX
      c.cy = bestY
      result[k] = best
    } else result[k] = atCentroid
    evaluate(c.cx, c.cy)
    if (riseWidth() < MIN_RISE_WIDTH) result[k] = Infinity
  })
  return result
}

/** Douglas-Peucker on the color-vs-offset curve: fewest stops within `tolerance` (8-bit levels). */
function simplifyStops(samples: GradientStop[], tolerance: number): GradientStop[] {
  if (samples.length <= 2) return samples
  const keep = new Uint8Array(samples.length)
  keep[0] = 1
  keep[samples.length - 1] = 1
  const recurse = (i: number, j: number) => {
    if (j <= i + 1) return
    const a = samples[i]!
    const b = samples[j]!
    let worst = -1
    let worstError = tolerance
    for (let k = i + 1; k < j; k++) {
      const s = samples[k]!
      const t = (s.offset - a.offset) / Math.max(1e-9, b.offset - a.offset)
      const error = Math.max(Math.abs(a.r + (b.r - a.r) * t - s.r), Math.abs(a.g + (b.g - a.g) * t - s.g), Math.abs(a.b + (b.b - a.b) * t - s.b))
      if (error > worstError) {
        worstError = error
        worst = k
      }
    }
    if (worst < 0) return
    keep[worst] = 1
    recurse(i, worst)
    recurse(worst, j)
  }
  recurse(0, samples.length - 1)
  return samples.filter((_, k) => keep[k])
}

/** Distance (sRGB 0-1) from color c to the segment a-b, and the blend parameter. */
function segmentDistance(c: number[], a: number[], b: number[]): number {
  const d = [b[0]! - a[0]!, b[1]! - a[1]!, b[2]! - a[2]!]
  const len2 = d[0]! * d[0]! + d[1]! * d[1]! + d[2]! * d[2]!
  let t = len2 > 0 ? ((c[0]! - a[0]!) * d[0]! + (c[1]! - a[1]!) * d[1]! + (c[2]! - a[2]!) * d[2]!) / len2 : 0
  t = Math.max(0, Math.min(1, t))
  return Math.hypot(a[0]! + d[0]! * t - c[0]!, a[1]! + d[1]! * t - c[1]!, a[2]! + d[2]! * t - c[2]!)
}

/**
 * Thin regions along a gradient's edge — the outermost band, or the
 * anti-aliasing blend between the gradient and what surrounds it — have no
 * interior pixels, so they never join a group and would be drawn as flat
 * slivers on top of the gradient. A thin region touching a gradient group
 * joins it when its color lies on the gradient's color path, or is a blend
 * of a gradient color and another neighbour's color. A genuine outline (a
 * dark stroke around a light gradient) matches neither and is kept.
 */
function absorbSlivers(
  groupOfRegion: Int32Array,
  regionCount: number,
  allPairs: { a: number; b: number }[],
  stats: Float64Array,
  fullColor: Float64Array,
  excluded: (region: number) => boolean,
  radialFills: GradientFill[],
  linearFits: Fit[],
  firstLinear: number,
): void {
  const neighbours: number[][] = Array.from({ length: regionCount }, () => [])
  for (const { a, b } of allPairs) {
    neighbours[a]!.push(b)
    neighbours[b]!.push(a)
  }
  const colorOf = (r: number): number[] => {
    const o = r * 4
    const n = Math.max(1, fullColor[o + 3]!)
    return [fullColor[o]! / n, fullColor[o + 1]! / n, fullColor[o + 2]! / n]
  }
  // A group's color path: its stops (radial) or its fitted ramp end points (linear).
  const pathOf = (g: number): number[][] => {
    if (g < firstLinear) return radialFills[g]!.stops.map((s) => [s.r / 255, s.g / 255, s.b / 255])
    const fit = linearFits[g - firstLinear]!
    const half = fit.ramp / Math.max(1e-9, Math.hypot(fit.slope[0], fit.slope[1], fit.slope[2])) / 2
    return [-1, 1].map((sign) => fit.mean.map((m, ch) => m + sign * fit.slope[ch]! * half))
  }
  const paths = new Map<number, number[][]>()
  const distanceToPath = (c: number[], g: number) => {
    let path = paths.get(g)
    if (!path) {
      path = pathOf(g)
      paths.set(g, path)
    }
    let best = Infinity
    for (let i = 0; i + 1 < path.length; i++) best = Math.min(best, segmentDistance(c, path[i]!, path[i + 1]!))
    if (path.length === 1) best = Math.hypot(c[0]! - path[0]![0]!, c[1]! - path[0]![1]!, c[2]! - path[0]![2]!)
    return { best, path }
  }

  // Repeat: slivers can touch the gradient only through other slivers.
  for (let pass = 0, changed = true; pass < 4 && changed; pass++) {
  changed = false
  for (let r = 0; r < regionCount; r++) {
    if (groupOfRegion[r]! >= 0 || excluded(r) || stats[r * STAT_SIZE]! > 0.25 * fullColor[r * 4 + 3]!) continue // thin: mostly edge pixels
    const c = colorOf(r)
    let target = -1
    for (const nb of neighbours[r]!) {
      const g = groupOfRegion[nb]!
      if (g < 0) continue
      const { best, path } = distanceToPath(c, g)
      let ok = best < 0.08
      // Or an AA blend of a gradient color and another neighbour's color.
      for (const other of neighbours[r]!) {
        if (ok) break
        if (groupOfRegion[other] === g) continue
        const oc = colorOf(other)
        for (const stop of path) if (segmentDistance(c, stop, oc) < 0.05) ok = true
      }
      if (ok) {
        target = g
        break
      }
    }
    if (target >= 0) {
      groupOfRegion[r] = target
      changed = true
    }
  }
  }
}

/** Color of a fitted gradient fill at a working-space point (pixel centers are x + 0.5). */
function fillColorAt(fill: GradientFill, px: number, py: number): [number, number, number] {
  let t: number
  if (fill.kind === 'radial') {
    t = fill.r > 0 ? Math.hypot(px - fill.cx, py - fill.cy) / fill.r : 0
  } else {
    const dx = fill.x2 - fill.x1
    const dy = fill.y2 - fill.y1
    const len2 = dx * dx + dy * dy
    t = len2 > 0 ? ((px - fill.x1) * dx + (py - fill.y1) * dy) / len2 : 0
  }
  t = Math.max(0, Math.min(1, t))
  const stops = fill.stops
  if (stops.length === 0) return [fill.mean.r, fill.mean.g, fill.mean.b]
  if (t <= stops[0]!.offset) return [stops[0]!.r, stops[0]!.g, stops[0]!.b]
  for (let i = 1; i < stops.length; i++) {
    const b = stops[i]!
    if (t <= b.offset) {
      const a = stops[i - 1]!
      const u = b.offset > a.offset ? (t - a.offset) / (b.offset - a.offset) : 0
      return [a.r + (b.r - a.r) * u, a.g + (b.g - a.g) * u, a.b + (b.b - a.b) * u]
    }
  }
  const last = stops[stops.length - 1]!
  return [last.r, last.g, last.b]
}

/**
 * "Do no harm" check for gradient groups. A region keeps its gradient fill
 * only if the fitted fill reproduces the region's actual pixels at least as
 * well as the region's own flat palette color. Genuine gradient bands pass
 * easily (a flat band misses the ramp). Photographic texture and small
 * detail regions (eyes, highlights, text) absorbed into a smooth group do
 * not, so they stay flat instead of being smeared into the gradient.
 * Measured: Professional photos went from ΔE 9.6 to Quick-level without this.
 *
 * Mutates `result.groupOfRegion`; fills left with no regions are dropped and
 * the remaining groups re-indexed.
 */
export function validateGradientGroups(
  image: RgbaImage,
  regionIds: Int32Array,
  regionCount: number,
  flatColorOf: (region: number) => [number, number, number] | null,
  result: GradientResult,
): GradientResult {
  const { width: w, height: h, data } = image
  const gradErr = new Float64Array(regionCount)
  const flatErr = new Float64Array(regionCount)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = y * w + x
      const region = regionIds[p]!
      const g = result.groupOfRegion[region]!
      if (g < 0) continue
      const flat = flatColorOf(region)
      if (!flat) continue
      const r = data[p * 4] ?? 0
      const gg = data[p * 4 + 1] ?? 0
      const b = data[p * 4 + 2] ?? 0
      const fill = fillColorAt(result.fills[g]!, x + 0.5, y + 0.5)
      gradErr[region] = gradErr[region]! + (r - fill[0]) ** 2 + (gg - fill[1]) ** 2 + (b - fill[2]) ** 2
      flatErr[region] = flatErr[region]! + (r - flat[0]) ** 2 + (gg - flat[1]) ** 2 + (b - flat[2]) ** 2
    }
  }
  const used = new Uint8Array(result.fills.length)
  for (let region = 0; region < regionCount; region++) {
    const g = result.groupOfRegion[region]!
    if (g < 0) continue
    if (flatColorOf(region) && gradErr[region]! > flatErr[region]!) result.groupOfRegion[region] = -1
    else used[g] = 1
  }
  const remap = new Int32Array(result.fills.length).fill(-1)
  const fills: GradientFill[] = []
  result.fills.forEach((fill, g) => {
    if (used[g]) {
      remap[g] = fills.length
      fills.push(fill)
    }
  })
  for (let region = 0; region < regionCount; region++) {
    const g = result.groupOfRegion[region]!
    if (g >= 0) result.groupOfRegion[region] = remap[g]!
  }
  return { groupOfRegion: result.groupOfRegion, fills }
}
