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
import { bilateralDenoise, downscaleArea, gaussianBlur, restoreJpegChroma, upscaleBilinear, upscaleMaskStrict, type RgbaImage } from './raster'
import { computeFlatMask, computeOklab, extractDetailColors, extractPalette, labelPixels, TRANSPARENT_LABEL, type PaletteColor } from './palette'
import { connectedComponents, dissolveBlendSlivers, mergeSmallRegions } from './regions'
import { detectGradients, validateGradientGroups, type GradientFill } from './gradients'
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
  /**
   * Cap on the working size reached by auto-upsampling a small image. It may
   * exceed maxWorkingPixels: an image small enough to upsample costs little
   * to decode, so the trace itself can use more of the memory budget.
   */
  maxUpscaledPixels: number
  /** Edge-preserving denoise: 'auto' estimates sensor/JPEG noise. */
  denoise: 'auto' | 'off' | 'on'
  /** stacked: shapes layered, no seams (default). cutout: exact non-overlapping partition. */
  mode: TraceOutputMode
  /**
   * Stacked mode: width (source px) of the same-color stroke drawn under
   * edges shared with shapes drawn later, which removes anti-aliasing seams.
   * 0 disables.
   */
  underlay: number
  /** Keep large flat inks apart when their gap exceeds this × their noise spread (see PaletteOptions.separation). 0 disables. */
  paletteSeparation: number
  /** Decimal places of path coordinates (source px); -1 = auto (step ≤ 1/5000 of the longer side). */
  precision: number
  /** Coverage-preserving labeling that keeps hairlines, small-text stems and thin gaps (see palette.ts). */
  thinFeatures: boolean
  /** Radius (source px) within which a near-solid pixel marks a feature as wide, not thin. */
  thinPeakScale: number
  /** Alpha below which pixels are treated as transparent. */
  alphaThreshold: number
  /** Upper bound on output regions; speckle removal coarsens adaptively above it. */
  maxRegions: number
  /** Restore sharp corners rounded off by anti-aliasing and resampling. */
  snapCorners: boolean
  /** Reconstruct smooth color ramps as SVG linear gradients instead of flat bands. */
  gradients: boolean
  /** Source encoding hint: lossy JPEG input gets artifact-aware cleanup. */
  sourceFormat: 'png' | 'jpeg' | 'webp' | 'unknown'
  /** Called after each pipeline stage (profiling and memory measurement). */
  onStage?: (stage: string) => void
  /**
   * Original size of an input the caller already reduced with
   * fitWorkingSize (so it could drop the full-resolution decode early). The
   * SVG keeps these dimensions; the result is identical to tracing the
   * original.
   */
  sourceSize?: { width: number; height: number }
}

export const DEFAULT_ENGINE_OPTIONS: TraceEngineOptions = {
  maxColors: 48,
  mergeDistance: 0.05,
  speckleArea: 0,
  alphaMax: 1.0,
  optTolerance: 0.2,
  upscale: 0,
  maxWorkingPixels: 2_000_000,
  maxUpscaledPixels: 2_000_000,
  denoise: 'auto',
  mode: 'stacked',
  underlay: 1,
  paletteSeparation: 3,
  precision: -1,
  thinFeatures: true,
  thinPeakScale: 1,
  alphaThreshold: 128,
  maxRegions: 6000,
  snapCorners: true,
  gradients: false,
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
  gradientCount: number
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

/**
 * Step 1 of traceImage: area-downsamples an image above maxWorkingPixels to
 * the engine's working size (returns the input unchanged otherwise). Callers
 * holding a large decode can run this first, release the full-resolution
 * pixels, and trace the result with `sourceSize` set to the original size.
 */
const NO_POINTS = new Int32Array(0)

export function fitWorkingSize(image: RgbaImage, maxWorkingPixels: number): RgbaImage {
  const pixels = image.width * image.height
  if (pixels <= maxWorkingPixels) return image
  const ratio = Math.sqrt(maxWorkingPixels / pixels)
  return downscaleArea(image, Math.max(1, Math.floor(image.width * ratio)), Math.max(1, Math.floor(image.height * ratio)))
}

export function traceImage(input: ImageData | RgbaImage, overrides: Partial<TraceEngineOptions> = {}): TraceEngineResult {
  const options: TraceEngineOptions = { ...DEFAULT_ENGINE_OPTIONS, ...overrides }
  const timings: Record<string, number> = {}
  let mark = performance.now()
  const lap = (name: string) => {
    const now = performance.now()
    timings[name] = now - mark
    options.onStage?.(name)
    mark = performance.now()
  }

  const sourceWidth = options.sourceSize?.width ?? input.width
  const sourceHeight = options.sourceSize?.height ?? input.height

  // Steps 1-6a run in their own scope so every per-pixel buffer (working
  // image, OKLab, masks, labels, region ids: ~30 MB at the 1.2 MP working
  // size) is garbage before curve fitting and SVG output, which only need the
  // regions' colors and their shared boundary chains (Worker memory).
  const seg = (() => {
    // 1. Bound the working size for huge inputs.
    let image = fitWorkingSize({ width: input.width, height: input.height, data: input.data }, options.maxWorkingPixels)
    lap('downscale')

    // 2. Denoise at (near) source resolution, before upsampling spreads noise.
    // JPEG ringing/mosquito noise concentrates right at edges, where a global
    // noise estimate barely sees it, so the format hint forces cleanup.
    const lossy = options.sourceFormat === 'jpeg'
    const noiseSigma = estimateNoiseSigma(image)
    const denoise = options.denoise === 'on' || (options.denoise === 'auto' && (lossy || noiseSigma > 1.2))
    if (lossy) image = restoreJpegChroma(image)
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
      separation: options.paletteSeparation,
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
    const upscale = options.upscale > 0 ? Math.round(options.upscale) : autoUpscale(image.width, image.height, Math.max(options.maxWorkingPixels, options.maxUpscaledPixels))
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
    let labels = labelPixels(image, lab, opaque, flat, palette, 2 * upscale + 1, options.mergeDistance * 2, options.thinFeatures ? upscale + 2 : 0, Math.max(1, Math.round(upscale * options.thinPeakScale)))
    lap('label')

    // 5. Speckle cleanup and final regions.
    labels = mergeSmallRegions(labels, width, height, palette, minArea)
    labels = dissolveBlendSlivers(labels, width, height, palette, lab, 0.75 * Math.sqrt(sourceToWorking))
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

    // 5b. Gradient reconstruction: merge posterized bands back into regions
    //     filled with fitted linear gradients (labels >= palette.length).
    let gradientFills: GradientFill[] = []
    if (options.gradients && regions.count > 1) {
      const detected = detectGradients(image, regions.ids, regions.count, (r) => regions.labels[r] === TRANSPARENT_LABEL, {
        maxResidual: 0.02,
        minRamp: 0.08,
        minRegionRamp: 0.02,
        minArea: minArea * 4,
        edgeMargin: Math.ceil(1.5 * upscale) + 1,
      })
      const gradient = validateGradientGroups(image, regions.ids, regions.count, (r) => {
        const color = palette[regions.labels[r]!]
        return color ? [color.r, color.g, color.b] : null
      }, detected)
      if (gradient.fills.length > 0) {
        const base = palette.length
        for (let p = 0; p < n; p++) {
          const g = gradient.groupOfRegion[regions.ids[p]!]!
          if (g >= 0) labels[p] = base + g
        }
        regions = connectedComponents(labels, width, height)
        gradientFills = gradient.fills
      }
    }
    lap('gradients')

    // 6. Shared boundaries and curve fitting.
    const chains = extractChains(regions.ids, width, height)
    const boundaries = buildRegionBoundaries(chains, regions.count)
    lap('chains')
    return { width, height, upscale, denoise, noiseSigma, sourceToWorking, palette, regionLabels: regions.labels, regionCount: regions.count, chains, boundaries, gradientFills }
  })()
  const { width, height, upscale, denoise, noiseSigma, sourceToWorking, palette, chains, boundaries, gradientFills } = seg
  const regions = { labels: seg.regionLabels, count: seg.regionCount }
  const workingPerSource = Math.sqrt(sourceToWorking)
  const fitOptions = {
    alphaMax: options.alphaMax,
    optTolerance: options.optTolerance * workingPerSource,
    cornerSnap: options.snapCorners
      ? { minLineLength: 2.5 * workingPerSource, maxCornerSpan: 1.5 * workingPerSource, minTurnDegrees: 30 }
      : null,
  }
  const fitted: FittedChain[] = (() => {
    const polygons = chains.map((chain) => buildPolygon(chain.points, chain.closed, fitOptions))
    refineJunctions(polygons, width, height, 0.75 * workingPerSource)
    return polygons.map((polygon) => buildCurve(polygon, fitOptions))
  })()
  // Only the chains' side regions are needed from here on; drop their lattice points.
  for (const chain of chains) chain.points = NO_POINTS
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
  // Auto: coordinate step at most 1/5000 of the longer side (3 decimals
  // under 50 px, 2 under 500 px, 1 under 5000 px) — finer is invisible even at
  // 4× zoom and only adds bytes.
  const precision = options.precision >= 0 ? options.precision : Math.max(0, Math.ceil(Math.log10(5000 / Math.max(sourceWidth, sourceHeight))))
  const isTransparentRegion = (region: number) => region === OUTSIDE || regions.labels[region] === TRANSPARENT_LABEL
  const loopChains = (loop: RegionLoop) => loop.uses.map((use) => fittedUse(use.chain, use.reversed))
  const bordersTransparent = (loop: RegionLoop) =>
    loop.uses.some((use) => {
      const chain = chains[use.chain]!
      return isTransparentRegion(use.reversed ? chain.left : chain.right)
    })

  const fillFor = (label: number): string => {
    if (label >= palette.length) return `url(#g${label - palette.length})`
    const color = palette[label]!
    return toShortHex(color.r, color.g, color.b)
  }
  const round = (v: number) => Math.round(v * scale * 100) / 100
  const defs =
    gradientFills.length === 0
      ? ''
      : `<defs>${gradientFills
          .map(
            (fill, g) => {
              const stops = fill.stops.map((stop) => `<stop offset="${Math.round(stop.offset * 1000) / 1000}" stop-color="${toShortHex(stop.r, stop.g, stop.b)}"/>`).join('')
              return fill.kind === 'radial'
                ? `<radialGradient id="g${g}" gradientUnits="userSpaceOnUse" cx="${round(fill.cx)}" cy="${round(fill.cy)}" r="${round(fill.r)}">${stops}</radialGradient>`
                : `<linearGradient id="g${g}" gradientUnits="userSpaceOnUse" x1="${round(fill.x1)}" y1="${round(fill.y1)}" x2="${round(fill.x2)}" y2="${round(fill.y2)}">${stops}</linearGradient>`
            },
          )
          .join('')}</defs>`
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
      paths.push(`<path fill="${fillFor(label)}" d="${builder.toString()}"/>`)
    }
  } else {
    drawable.sort((a, b) => Math.abs(b.outer!.area) - Math.abs(a.outer!.area))
    const drawOrder = new Map<number, number>()
    drawable.forEach((boundary, i) => drawOrder.set(boundary.region, i))
    const underlayWidth = Math.round(options.underlay * 100) / 100
    for (const boundary of drawable) {
      const builder = new PathBuilder(scale, precision)
      builder.appendLoop(loopChains(boundary.outer!))
      const visibleLoops = [boundary.outer!]
      for (const hole of boundary.holes) {
        if (bordersTransparent(hole)) {
          builder.appendLoop(loopChains(hole))
          visibleLoops.push(hole)
        }
      }
      const fill = fillFor(regions.labels[boundary.region]!)
      paths.push(`<path fill="${fill}" d="${builder.toString()}"/>`)

      // Underlay: two touching shapes that are not nested each anti-alias
      // their side of the shared edge, so their coverages add up to ~75% and
      // the background shows through as a hairline seam ("white lines between
      // shapes"). Stroking the shared edges in the color of the shape drawn
      // first puts paint under the later shape's edge; the later shape covers
      // the rest of the stroke. Holes that stay filled need none — the
      // region's own fill already lies under whatever is drawn in them.
      if (options.underlay > 0) {
        const order = drawOrder.get(boundary.region)!
        const stroke = new PathBuilder(scale, Math.max(1, precision - 1))
        for (const loop of visibleLoops) {
          for (const use of loop.uses) {
            const chain = chains[use.chain]!
            const other = use.reversed ? chain.left : chain.right
            const otherOrder = drawOrder.get(other)
            if (otherOrder !== undefined && otherOrder > order) stroke.appendOpen(fittedUse(use.chain, use.reversed))
          }
        }
        if (!stroke.isEmpty()) {
          paths.push(`<path fill="none" stroke="${fill}" stroke-width="${underlayWidth}" stroke-linejoin="round" d="${stroke.toString()}"/>`)
        }
      }
    }
  }
  lap('svg')

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${sourceWidth}" height="${sourceHeight}" viewBox="0 0 ${sourceWidth} ${sourceHeight}">` +
    defs +
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
      gradientCount: gradientFills.length,
      timingsMs: timings,
    },
  }
}
