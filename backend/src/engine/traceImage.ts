/**
 * Vectorla tracing engine — entry point.
 *
 *   decode → (denoise) → (resample: upscale small / downscale huge)
 *     → OKLab → flat-pixel palette → AA-aware labeling → speckle merge
 *     → connected regions → planar-map chains (shared boundaries)
 *     → Potrace-grade curve fitting per chain → stacked or cutout SVG
 *
 * Pure TypeScript over typed arrays: no DOM, no WASM, no native deps, so it
 * runs unchanged in Cloudflare Workers, Node, and the browser.
 */
import { PathBuilder } from './svgWriter'
import { toShortHex } from './color'
import { bilateralDenoise, downscaleArea, gaussianBlur, upscaleBilinear, upscaleMaskStrict, type RgbaImage } from './raster'
import { computeFlatMask, computeOklab, extractDetailColors, extractPalette, labelPixels, TRANSPARENT_LABEL, type PaletteColor } from './palette'
import { connectedComponents, mergeSmallRegions } from './regions'
import { buildRegionBoundaries, extractChains, OUTSIDE, type RegionLoop } from './planarMap'
import { buildCurve, buildPolygon, refineJunctions, reverseFitted, type FittedChain } from './curveFit'

export type TraceOutputMode = 'stacked' | 'cutout'

export interface TraceEngineOptions {
  /** Upper bound on palette size. */
  maxColors: number
  /** OKLab distance below which colors merge (≈0.02 is a just-noticeable difference). */
  mergeDistance: number
  /** Regions smaller than this many *source* pixels are merged into a neighbour. 0 = auto. */
  speckleArea: number
  /** Corner threshold; lower keeps more sharp corners. */
  alphaMax: number
  /** Curve-merge tolerance in source pixels. */
  optTolerance: number
  /** Integer upsampling factor before segmentation; 0 = auto. */
  upscale: number
  /** Images above this many pixels are area-downsampled for tracing. */
  maxWorkingPixels: number
  /** Edge-preserving denoise: 'auto' estimates sensor/JPEG noise. */
  denoise: 'auto' | 'off' | 'on'
  /** stacked: shapes layered, no seams (default). cutout: exact non-overlapping partition. */
  mode: TraceOutputMode
  /** Alpha below which pixels are treated as transparent. */
  alphaThreshold: number
  /** Upper bound on output regions; speckle removal coarsens adaptively above it. */
  maxRegions: number
  /** Restore sharp corners rounded off by anti-aliasing and resampling. */
  snapCorners: boolean
  /** Source encoding hint: lossy JPEG input gets artifact-aware cleanup. */
  sourceFormat: 'png' | 'jpeg' | 'webp' | 'unknown'
}

export const DEFAULT_ENGINE_OPTIONS: TraceEngineOptions = {
  maxColors: 48,
  mergeDistance: 0.05,
  speckleArea: 0,
  alphaMax: 1.0,
  optTolerance: 0.2,
  upscale: 0,
  maxWorkingPixels: 2_000_000,
  denoise: 'auto',
  mode: 'stacked',
  alphaThreshold: 128,
  maxRegions: 6000,
  snapCorners: true,
  sourceFormat: 'unknown',
}

export interface TraceEngineStats {
  sourceWidth: number
  sourceHeight: number
  workingWidth: number
  workingHeight: number
  upscale: number
  denoised: boolean
  noiseSigma: number
  paletteSize: number
  regionCount: number
  chainCount: number
  pathCount: number
  timingsMs: Record<string, number>
}

export interface TraceEngineResult {
  svg: string
  palette: PaletteColor[]
  stats: TraceEngineStats
}

/** Robust luma noise estimate: MAD of the 4-neighbour Laplacian, in 8-bit levels. */
export function estimateNoiseSigma(image: RgbaImage): number {
  const { width: w, height: h, data } = image
  if (w < 3 || h < 3) return 0
  const luma = (p: number) => 0.299 * (data[p * 4] ?? 0) + 0.587 * (data[p * 4 + 1] ?? 0) + 0.114 * (data[p * 4 + 2] ?? 0)
  const step = Math.max(1, Math.floor(Math.sqrt((w * h) / 40_000)))
  const values: number[] = []
  for (let y = 1; y < h - 1; y += step) {
    for (let x = 1; x < w - 1; x += step) {
      const p = y * w + x
      if ((data[p * 4 + 3] ?? 0) < 255) continue
      const lap = 4 * luma(p) - luma(p - 1) - luma(p + 1) - luma(p - w) - luma(p + w)
      values.push(Math.abs(lap))
    }
  }
  if (values.length === 0) return 0
  values.sort((a, b) => a - b)
  // Median of |laplacian| is ~0 for flat art; for Gaussian noise σ_lap = √20·σ.
  const median = values[Math.floor(values.length / 2)] ?? 0
  return (1.4826 * median) / Math.sqrt(20)
}

function autoUpscale(width: number, height: number, maxWorkingPixels: number): number {
  const pixels = width * height
  const target = 2_000_000
  let factor = Math.floor(Math.sqrt(target / Math.max(1, pixels)))
  factor = Math.max(1, Math.min(4, factor))
  while (factor > 1 && pixels * factor * factor > maxWorkingPixels) factor--
  return factor
}

export function traceImage(input: ImageData | RgbaImage, overrides: Partial<TraceEngineOptions> = {}): TraceEngineResult {
  const options: TraceEngineOptions = { ...DEFAULT_ENGINE_OPTIONS, ...overrides }
  const timings: Record<string, number> = {}
  let mark = performance.now()
  const lap = (name: string) => {
    const now = performance.now()
    timings[name] = now - mark
    mark = now
  }

  const sourceWidth = input.width
  const sourceHeight = input.height
  let image: RgbaImage = { width: input.width, height: input.height, data: input.data }

  // 1. Bound the working size for huge inputs.
  if (sourceWidth * sourceHeight > options.maxWorkingPixels) {
    const ratio = Math.sqrt(options.maxWorkingPixels / (sourceWidth * sourceHeight))
    image = downscaleArea(image, Math.max(1, Math.floor(sourceWidth * ratio)), Math.max(1, Math.floor(sourceHeight * ratio)))
  }
  lap('downscale')

  // 2. Denoise at (near) source resolution, before upsampling spreads noise.
  // JPEG ringing/mosquito noise concentrates right at edges, where a global
  // noise estimate barely sees it, so the format hint forces cleanup.
  const lossy = options.sourceFormat === 'jpeg'
  const noiseSigma = estimateNoiseSigma(image)
  const denoise = options.denoise === 'on' || (options.denoise === 'auto' && (lossy || noiseSigma > 1.2))
  if (denoise) image = bilateralDenoise(image, 2, Math.max(lossy ? 22 : 14, 3.5 * noiseSigma))
  lap('denoise')

  // 3. Palette at source resolution: here anti-aliased edge pixels differ
  //    sharply from their neighbours, so the flat-pixel test cleanly excludes
  //    them (after upsampling, blends become smooth ramps that look "flat").
  const sourcePixels = sourceWidth * sourceHeight
  const speckleSource = options.speckleArea > 0 ? options.speckleArea : Math.max(2, Math.min(40, sourcePixels * 5e-6)) * (lossy ? 3 : 1)
  const baseN = image.width * image.height
  const baseOpaque = new Uint8Array(baseN)
  for (let p = 0; p < baseN; p++) if ((image.data[p * 4 + 3] ?? 0) >= options.alphaThreshold) baseOpaque[p] = 1
  const baseLab = computeOklab(image)
  const baseFlat = computeFlatMask(image, baseLab, baseOpaque)
  const baseToSource = sourcePixels / baseN
  const palette = extractPalette(image, baseLab, baseOpaque, baseFlat, {
    mergeDistance: options.mergeDistance,
    maxColors: options.maxColors,
    minClusterFraction: Math.max(3e-5, (speckleSource * 2) / baseToSource / Math.max(1, baseN)),
    alphaThreshold: options.alphaThreshold,
  })
  palette.push(
    ...extractDetailColors(image, baseLab, baseOpaque, baseFlat, palette, {
      mergeDistance: options.mergeDistance,
      minPixels: Math.max(6, Math.round((speckleSource * 3) / baseToSource)),
      maxColors: options.maxColors,
    }),
  )
  lap('palette')

  // 4. Upsample small inputs so anti-aliasing becomes sub-pixel geometry;
  //    a light blur removes bilinear's grid-periodic ripple.
  const upscale = options.upscale > 0 ? Math.round(options.upscale) : autoUpscale(image.width, image.height, options.maxWorkingPixels)
  const baseWidth = image.width
  const baseHeight = image.height
  if (upscale > 1) image = gaussianBlur(upscaleBilinear(image, upscale), 0.45 * upscale)
  else if (lossy) image = gaussianBlur(image, 0.5)
  lap('upscale')

  const { width, height } = image
  const n = width * height
  const opaque = new Uint8Array(n)
  for (let p = 0; p < n; p++) if ((image.data[p * 4 + 3] ?? 0) >= options.alphaThreshold) opaque[p] = 1
  const lab = upscale > 1 ? computeOklab(image) : baseLab
  const flat = upscaleMaskStrict(baseFlat, baseWidth, baseHeight, upscale)
  for (let p = 0; p < n; p++) if (!opaque[p]) flat[p] = 0
  lap('oklab')

  const sourceToWorking = (width / sourceWidth) * (height / sourceHeight)
  const minArea = Math.max(1, Math.round(speckleSource * sourceToWorking))
  let labels = labelPixels(image, lab, opaque, flat, palette, 2 * upscale + 1, options.mergeDistance * 2)
  lap('label')

  // 5. Speckle cleanup and final regions.
  labels = mergeSmallRegions(labels, width, height, palette, minArea)
  let regions = connectedComponents(labels, width, height)
  // Region budget: pathological inputs (pure noise, dithering, halftones)
  // would otherwise produce tens of thousands of paths and megabyte SVGs.
  // Coarsen speckle removal until the region count is sane.
  let budgetArea = minArea
  while (regions.count > options.maxRegions && budgetArea < n / 50) {
    budgetArea *= 2
    labels = mergeSmallRegions(labels, width, height, palette, budgetArea)
    regions = connectedComponents(labels, width, height)
  }
  lap('regions')

  // 6. Shared boundaries and curve fitting.
  const chains = extractChains(regions.ids, width, height)
  const boundaries = buildRegionBoundaries(chains, regions.count)
  lap('chains')
  const workingPerSource = Math.sqrt(sourceToWorking)
  const fitOptions = {
    alphaMax: options.alphaMax,
    optTolerance: options.optTolerance * workingPerSource,
    cornerSnap: options.snapCorners
      ? { minLineLength: 2.5 * workingPerSource, maxCornerSpan: 1.5 * workingPerSource, minTurnDegrees: 30 }
      : null,
  }
  const polygons = chains.map((chain) => buildPolygon(chain.points, chain.closed, fitOptions))
  refineJunctions(polygons, width, height, 0.75 * workingPerSource)
  const fitted: FittedChain[] = polygons.map((polygon) => buildCurve(polygon, fitOptions))
  const reversedCache = new Map<number, FittedChain>()
  const fittedUse = (chain: number, reversed: boolean): FittedChain => {
    if (!reversed) return fitted[chain]!
    let r = reversedCache.get(chain)
    if (!r) {
      r = reverseFitted(fitted[chain]!)
      reversedCache.set(chain, r)
    }
    return r
  }
  lap('fit')

  // 7. SVG output.
  const scale = sourceWidth / width
  const precision = Math.max(sourceWidth, sourceHeight) <= 600 ? 2 : 1
  const isTransparentRegion = (region: number) => region === OUTSIDE || regions.labels[region] === TRANSPARENT_LABEL
  const loopChains = (loop: RegionLoop) => loop.uses.map((use) => fittedUse(use.chain, use.reversed))
  const bordersTransparent = (loop: RegionLoop) =>
    loop.uses.some((use) => {
      const chain = chains[use.chain]!
      return isTransparentRegion(use.reversed ? chain.left : chain.right)
    })

  const drawable = boundaries.filter((b) => b.outer && !isTransparentRegion(b.region))
  const paths: string[] = []
  if (options.mode === 'cutout') {
    const byColor = new Map<number, PathBuilder>()
    for (const boundary of drawable) {
      const label = regions.labels[boundary.region]!
      let builder = byColor.get(label)
      if (!builder) {
        builder = new PathBuilder(scale, precision)
        byColor.set(label, builder)
      }
      builder.appendLoop(loopChains(boundary.outer!))
      for (const hole of boundary.holes) builder.appendLoop(loopChains(hole))
    }
    for (const [label, builder] of byColor) {
      const color = palette[label]!
      paths.push(`<path fill="${toShortHex(color.r, color.g, color.b)}" d="${builder.toString()}"/>`)
    }
  } else {
    drawable.sort((a, b) => Math.abs(b.outer!.area) - Math.abs(a.outer!.area))
    for (const boundary of drawable) {
      const builder = new PathBuilder(scale, precision)
      builder.appendLoop(loopChains(boundary.outer!))
      for (const hole of boundary.holes) {
        if (bordersTransparent(hole)) builder.appendLoop(loopChains(hole))
      }
      const color = palette[regions.labels[boundary.region]!]!
      paths.push(`<path fill="${toShortHex(color.r, color.g, color.b)}" d="${builder.toString()}"/>`)
    }
  }
  lap('svg')

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${sourceWidth}" height="${sourceHeight}" viewBox="0 0 ${sourceWidth} ${sourceHeight}">` +
    paths.join('') +
    '</svg>'

  return {
    svg,
    palette,
    stats: {
      sourceWidth,
      sourceHeight,
      workingWidth: width,
      workingHeight: height,
      upscale,
      denoised: denoise,
      noiseSigma,
      paletteSize: palette.length,
      regionCount: regions.count,
      chainCount: chains.length,
      pathCount: paths.length,
      timingsMs: timings,
    },
  }
}
