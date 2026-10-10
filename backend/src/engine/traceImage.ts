/**
 * Vectorla tracing engine — entry point.
 *
 *   decode → (denoise) → (resample: upscale small / downscale huge)
 *     → OKLab → flat-pixel palette → AA-aware labeling → speckle merge
 *     → connected regions → (gradient fills, shading refinement)
 *     → planar-map chains (shared boundaries)
 *     → Potrace-grade curve fitting per chain → stacked or cutout SVG
 *
 * Pure TypeScript over typed arrays: no DOM, no WASM, no native deps, so it
 * runs unchanged in Cloudflare Workers, Node, and the browser.
 */
import { PathBuilder } from './svgWriter'
import { toShortHex } from './color'
import { bilateralDenoise, downscaleBox, gaussianBlur, restoreJpegChroma, restoreRidges, ridgeMask, upscaleBilinear, upscaleMaskStrict, type RgbaImage } from './raster'
import { computeFlatMask, OklabSource, extractDetailColors, extractPalette, labelPixels, TRANSPARENT_LABEL, type PaletteColor } from './palette'
import { connectedComponents, dissolveBlendSlivers, mergeSmallRegions, regularizeLabels } from './regions'
import { detectGradients, validateGradientGroups, type GradientFill } from './gradients'
import { refineShading } from './refine'
import { buildRegionBoundaries, extractChains, OUTSIDE, type RegionLoop } from './planarMap'
import { buildCurve, buildPolygon, refineJunctions, reverseFitted, type FittedChain } from './curveFit'
import { checkpoint } from './memoryCheckpoint'

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
  /** Images above this many pixels are reduced (by a whole factor) for tracing. */
  maxWorkingPixels: number
  /**
   * The working-size cap for photo-like images (mostly textured pixels, see
   * workingPixelCap): they gain nothing from more resolution, which would only
   * multiply their region count, SVG size, time and memory.
   */
  photoMaxWorkingPixels: number
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
  /**
   * Speckle removal keeps a region under the speckle area when it contrasts
   * with the neighbour it would merge into by at least this OKLab distance
   * and covers at least detailAreaFraction of the speckle area (small
   * symbols, dots, gaps between outlines). 0 disables.
   */
  detailContrast: number
  detailAreaFraction: number
  /**
   * Hierarchical shading refinement (refine.ts): OKLab distance between the
   * levels shaded region interiors are re-quantized into. 0 disables.
   */
  shadingStep: number
  /** Flat inks seed palette clusters down to this fraction of mergeDistance apart (see PaletteOptions.inkSeedFraction). */
  inkSeedFraction: number
  /**
   * Line art and metal in textured, compressed artwork (photo-like by flat
   * fraction, see workingPixelCap: a JPEG of a shaded emblem): restore
   * hairlines when upsampling, label line pixels as blends of the local ink
   * and paper (labelPixels), and regularize labels between similar levels
   * (regularizeLabels). Clean artwork is unaffected.
   */
  textureDetail: boolean
  /**
   * Content class (classifyContent): measured with 'auto'; benchmarks may
   * force one. Photo-like inputs ('photo', 'emblem') get textureDetail; only
   * 'photo' gets the photo working-size cap (photoMaxWorkingPixels).
   */
  contentClass: 'auto' | ContentClass
  /** Search radial gradient centers instead of using the bands' centroid (gradients.ts). */
  radialCenterSearch: boolean
  /** Gradient grouping only across borders with a mean pixel step (sRGB 0-1) up to this; 0 = any border. */
  gradientBoundaryStep: number
  /** Upper bound on output regions; speckle removal coarsens adaptively above it. */
  maxRegions: number
  /** Regions kept when merging down to maxRegions would collapse a regular dense pattern (memory-bound). */
  maxRegionsHard: number
  /** Restore sharp corners rounded off by anti-aliasing and resampling. */
  snapCorners: boolean
  /** Reconstruct smooth color ramps as SVG linear gradients instead of flat bands. */
  gradients: boolean
  /** Source encoding hint: lossy JPEG input gets artifact-aware cleanup. */
  sourceFormat: 'png' | 'jpeg' | 'webp' | 'unknown'
  /**
   * Upsampling filter for small inputs: bilinear plus blur, or 'ridge', which
   * also restores isolated one-pixel hairlines with sharp Catmull-Rom samples
   * so the blur cannot average them away (see BENCHMARKS.md).
   */
  upscaleFilter: 'bilinear' | 'ridge'
  /** Blur after upsampling, in source pixels (removes interpolation ripple). */
  upscaleBlur: number
  /** Channel contrast that marks a ridge pixel for the 'ridge' upscale filter. */
  ridgeThreshold: number
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
  photoMaxWorkingPixels: 2_000_000,
  upscaleFilter: 'ridge',
  upscaleBlur: 0.45,
  ridgeThreshold: 32,
  maxUpscaledPixels: 2_000_000,
  denoise: 'auto',
  mode: 'stacked',
  underlay: 1,
  paletteSeparation: 3,
  precision: -1,
  thinFeatures: true,
  thinPeakScale: 1,
  alphaThreshold: 128,
  detailContrast: 0,
  detailAreaFraction: 0.25,
  shadingStep: 0,
  gradientBoundaryStep: 0,
  radialCenterSearch: false,
  textureDetail: false,
  contentClass: 'auto',
  inkSeedFraction: 1,
  maxRegions: 6000,
  maxRegionsHard: 40_000,
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
  /** What each simplifying stage did (diagnostics; see BENCHMARKS.md "Emblems"). */
  diagnostics: TraceDiagnostics
  timingsMs: Record<string, number>
}

export interface TraceDiagnostics {
  /** Share of flat pixels (below PHOTO_FLAT_FRACTION an input is photo-like) and the content class (classifyContent). */
  flatFraction: number
  contentClass: ContentClass
  /** True when the input was reduced for being photo-like (photoMaxWorkingPixels). */
  photoCap: boolean
  /** Speckle merge threshold (working px). */
  minArea: number
  /** Regions after speckle cleanup, before the region budget, gradients and shading refinement. */
  regionsAfterSpeckle: number
  /** Region-budget passes run (each doubles the merge area) and the final merge area (working px). */
  budgetPasses: number
  budgetArea: number
  /** Gradient groups found, and kept after validation against the flat colors. */
  gradientGroupsFound: number
  /** Regions re-quantized by shading refinement. */
  shadedRegions: number
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

const NO_POINTS = new Int32Array(0)
const NO_BYTES = new Uint8Array(0)
const NO_IMAGE: RgbaImage = { width: 0, height: 0, data: new Uint8ClampedArray(0) }

/**
 * Label regularization for textured artwork (regularizeLabels): cost of a
 * disagreeing neighbour in squared palette steps, and the largest OKLab
 * distance between levels it may trade (similar tones only, never inks).
 */
const REGULARIZE_BETA = 1.0
const REGULARIZE_MAX_SWITCH = 0.12

/** Working size from which a JPEG's colors are read after its light blur (traceWith, memory). */
const LAB_FROM_WORKING_PIXELS = 2_500_000

/** Detail-protected region-budget passes go up to this multiple of the speckle area (traceWith). */
const BUDGET_DETAIL_FACTOR = 16

/** Palette colors shading refinement may add (refine.ts). */
const MAX_SHADING_COLORS = 512

/** Below this share of flat pixels an image is photo-like (classifyContent). */
const PHOTO_FLAT_FRACTION = 0.7
/** A photo-like input with a plain border band and crisp outlines is an emblem (emblemFeatures). */
const EMBLEM_MIN_BORDER = 0.85
const EMBLEM_MIN_CRISPNESS = 0.3

/**
 * - artwork: mostly flat pixels (logos, icons, text, illustrations,
 *   gradient art);
 * - emblem: photo-like by flat fraction (shading, texture, compression) but
 *   drawn on a plain background with crisp outlines: an emblem, badge, seal
 *   or medal;
 * - photo: the rest.
 * Emblems and photos share the texture path (textureDetail); only photos
 * get the photo working-size cap, as an emblem's text and line art need the
 * resolution (BENCHMARKS.md "Content classes").
 */
export type ContentClass = 'artwork' | 'emblem' | 'photo'

export function classifyContent(image: RgbaImage, flat = flatFraction(image)): ContentClass {
  if (flat >= PHOTO_FLAT_FRACTION) return 'artwork'
  const { border, crispness } = emblemFeatures(image)
  return border >= EMBLEM_MIN_BORDER && crispness >= EMBLEM_MIN_CRISPNESS ? 'emblem' : 'photo'
}

/**
 * Share of (sampled) opaque pixels whose right and lower neighbours differ by
 * at most 3 in every channel. Measured on the 80-image benchmark: logos,
 * icons, text, illustrations and gradient art 0.72–0.99; photos 0.30–0.66.
 */
export function flatFraction(image: RgbaImage): number {
  const { width: w, height: h, data } = image
  const stride = Math.max(1, Math.round(Math.sqrt((w * h) / 250_000)))
  let flat = 0
  let total = 0
  for (let y = 0; y + 1 < h; y += stride) {
    for (let x = 0; x + 1 < w; x += stride) {
      const p = (y * w + x) * 4
      if (data[p + 3]! < 128) continue
      total++
      const r = p + 4
      const b = p + w * 4
      let diff = 0
      for (let c = 0; c < 3; c++) diff = Math.max(diff, Math.abs(data[p + c]! - data[r + c]!), Math.abs(data[p + c]! - data[b + c]!))
      if (diff <= 3) flat++
    }
  }
  return total > 0 ? flat / total : 1
}

/**
 * Emblem-likeness of a photo-like input, measured on block means at most
 * 512 px across (noise and compression texture average out):
 *  - border: share of the outer band (2% of the short side) within 0.04
 *    OKLab of its median color; transparency counts as white. Emblems
 *    0.86–1.0, photos 0.05–0.47 (a few on a dark sky or a plain slide
 *    0.75–0.91);
 *  - crispness: neighbouring block steps above 0.15 OKLab ÷ steps above
 *    0.04, i.e. how much of the image's structure is crisp outline. Emblems
 *    from 1200 px 0.40–0.78 (0.30–0.73 at 640 px), photos 0.0–0.31 (a
 *    scanned text page 0.54), at most 0.27 among those with a plain border.
 * Measured on 52 photo-like images (BENCHMARKS.md "Content classes").
 */
export function emblemFeatures(image: RgbaImage): { border: number; crispness: number } {
  const { width: w, height: h, data } = image
  const k = Math.max(1, Math.ceil(Math.max(w, h) / 512))
  const W = Math.max(1, Math.floor(w / k))
  const H = Math.max(1, Math.floor(h / k))
  const lab = new Float32Array(W * H * 3)
  const lin = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
  for (let by = 0; by < H; by++) {
    for (let bx = 0; bx < W; bx++) {
      let r = 0
      let g = 0
      let b = 0
      for (let y = by * k; y < by * k + k; y++) {
        for (let x = bx * k; x < bx * k + k; x++) {
          const p = (y * w + x) * 4
          const a = data[p + 3]! / 255
          r += data[p]! * a + 255 * (1 - a)
          g += data[p + 1]! * a + 255 * (1 - a)
          b += data[p + 2]! * a + 255 * (1 - a)
        }
      }
      const s = 255 * k * k
      const lr = lin(r / s)
      const lg = lin(g / s)
      const lb = lin(b / s)
      const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb)
      const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb)
      const q = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb)
      const o = (by * W + bx) * 3
      lab[o] = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * q
      lab[o + 1] = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * q
      lab[o + 2] = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * q
    }
  }
  const band = Math.max(2, Math.floor(0.02 * Math.min(W, H)))
  const borderPixels: number[] = []
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (y < band || y >= H - band || x < band || x >= W - band) borderPixels.push(y * W + x)
  const median = [0, 1, 2].map((c) => {
    const v = borderPixels.map((p) => lab[p * 3 + c]!).sort((a, b) => a - b)
    return v[v.length >> 1] ?? 0
  })
  let uniform = 0
  for (const p of borderPixels) if (Math.hypot(lab[p * 3]! - median[0]!, lab[p * 3 + 1]! - median[1]!, lab[p * 3 + 2]! - median[2]!) < 0.04) uniform++
  let strong = 0
  let medium = 0
  const step = (p: number, q: number) => Math.hypot(lab[p * 3]! - lab[q * 3]!, lab[p * 3 + 1]! - lab[q * 3 + 1]!, lab[p * 3 + 2]! - lab[q * 3 + 2]!)
  for (let y = 0; y + 1 < H; y++) {
    for (let x = 0; x + 1 < W; x++) {
      const p = y * W + x
      const d = Math.max(step(p, p + 1), step(p, p + W))
      if (d > 0.15) strong++
      if (d > 0.04) medium++
    }
  }
  return { border: borderPixels.length > 0 ? uniform / borderPixels.length : 0, crispness: medium > 0 ? strong / medium : 0 }
}

/**
 * Working-size cap for an input: maxWorkingPixels for artwork (logos, text,
 * illustrations) and emblems, photoMaxWorkingPixels for photos
 * (classifyContent). Inputs within the photo cap are never classified
 * (nothing to decide). A 2000 px shaded emblem reduced to 1000 px lost its
 * lettering and line art (BENCHMARKS.md "Content classes").
 *
 * The photo cap is skipped when auto-upsampling (maxUpscaledPixels) would
 * bring the reduced image back to at least its own size: a 1200² input would
 * be reduced to 600² and traced at 2x, i.e. at the same 1.44 MP working size
 * and memory, only with half the detail (a textured metal seal measured ΔE
 * 1.24 reduced vs 0.92 at full size, both 15.5 MB live; BENCHMARKS.md "Emblems").
 */
export function workingPixelCap(
  image: RgbaImage,
  options: Pick<TraceEngineOptions, 'maxWorkingPixels' | 'photoMaxWorkingPixels'> & Partial<Pick<TraceEngineOptions, 'maxUpscaledPixels' | 'contentClass'>>,
): number {
  const { width: w, height: h } = image
  if (w * h <= Math.min(options.maxWorkingPixels, options.photoMaxWorkingPixels)) return options.maxWorkingPixels
  const forced = options.contentClass && options.contentClass !== 'auto' ? options.contentClass : null
  const flat = forced ? 0 : flatFraction(image)
  if (forced ? forced !== 'photo' : flat >= PHOTO_FLAT_FRACTION) return options.maxWorkingPixels
  if (options.maxUpscaledPixels !== undefined && w * h <= options.maxWorkingPixels) {
    const k = reductionFactor(w, h, options.photoMaxWorkingPixels)
    if (autoUpscale(Math.ceil(w / k), Math.ceil(h / k), options.maxUpscaledPixels) >= k) return options.maxWorkingPixels
  }
  // Last: classifying an emblem takes a pass over the image.
  if (!forced && classifyContent(image, flat) === 'emblem') return options.maxWorkingPixels
  return options.photoMaxWorkingPixels
}

/** The whole factor fitWorkingSize reduces a w×h image by to fit maxWorkingPixels (> 1 only above it). */
function reductionFactor(w: number, h: number, maxWorkingPixels: number): number {
  if (w * h <= maxWorkingPixels) return 1
  let k = Math.max(2, Math.ceil(Math.sqrt((w * h) / maxWorkingPixels)))
  while (Math.ceil(w / k) * Math.ceil(h / k) > maxWorkingPixels) k++
  return k
}

/**
 * Step 1 of traceImage: reduces an image above maxWorkingPixels by the
 * smallest whole factor k that fits (exact k×k blocks, downscaleBox), and
 * returns it unchanged otherwise. A fractional resample (e.g. ×0.55) smears
 * every anti-aliased edge unevenly across pixel bins; measured on 4 MP renders,
 * an exact 2× reduction to 1.0 MP traces more accurately than a fractional one
 * to 1.2 MP (BENCHMARKS.md "High-resolution engine"). Callers holding a large
 * decode can run this first, release the full-resolution pixels, and trace the
 * result with `sourceSize` set to the original size.
 */
export function fitWorkingSize(image: RgbaImage, maxWorkingPixels: number): RgbaImage {
  const k = reductionFactor(image.width, image.height, maxWorkingPixels)
  return k > 1 ? downscaleBox(image, k) : image
}

export function traceImage(input: ImageData | RgbaImage, overrides: Partial<TraceEngineOptions> = {}): TraceEngineResult {
  return traceWith({ image: { width: input.width, height: input.height, data: input.data, scale: (input as RgbaImage).scale } }, overrides, false)
}

/**
 * traceImage for a caller that hands over its pixels: the engine takes
 * `source.image` and clears it, so the decoded upload (16 MB at 4 MP) can be
 * freed as soon as the first stage has produced its own copy instead of
 * staying alive for the whole trace.
 */
export function traceOwnedImage(source: { image: RgbaImage | null }, overrides: Partial<TraceEngineOptions> = {}): TraceEngineResult {
  return traceWith(source, overrides, true)
}

function traceWith(source: { image: RgbaImage | null }, overrides: Partial<TraceEngineOptions>, owned: boolean): TraceEngineResult {
  const options: TraceEngineOptions = { ...DEFAULT_ENGINE_OPTIONS, ...overrides }
  const timings: Record<string, number> = {}
  let mark = performance.now()
  const lap = (name: string) => {
    const now = performance.now()
    timings[name] = now - mark
    options.onStage?.(name)
    checkpoint(`after ${name}`)
    mark = performance.now()
  }

  if (!source.image) throw new Error('traceOwnedImage: source image already taken')
  const sourceWidth = options.sourceSize?.width ?? source.image.width
  const sourceHeight = options.sourceSize?.height ?? source.image.height

  // Steps 1-6a run in their own scope so every per-pixel buffer (working
  // image, OKLab, masks, labels, region ids: ~30 MB at the 1.2 MP working
  // size) is garbage before curve fitting and SVG output, which only need the
  // regions' colors and their shared boundary chains (Worker memory).
  const seg = (() => {
    // 1. Bound the working size for huge inputs.
    // Full-size buffers this trace may overwrite once retired: anything it
    // produced itself, and the input only if the caller handed it over (only
    // the caller's buffer is remembered, so an owned input is not kept alive).
    const foreign = owned ? null : source.image!.data
    const reusable = (img: RgbaImage) => img.data !== foreign
    const inputFlatFraction = flatFraction(source.image!)
    const contentClass = options.contentClass !== 'auto' ? options.contentClass : classifyContent(source.image!, inputFlatFraction)
    const cap = workingPixelCap(source.image!, { ...options, contentClass })
    const photoCap = cap < options.maxWorkingPixels && source.image!.width * source.image!.height > cap
    let image = fitWorkingSize(source.image!, cap)
    source.image = null
    // Source pixels per working pixel before any upsampling: exactly k after
    // a k× box reduction (whose last row/column of blocks may be partial).
    const baseScale = image.scale ?? sourceWidth / image.width
    // Classified before denoising, which flattens photos past the threshold.
    const photoLike = contentClass !== 'artwork'
    const textured = options.textureDetail && photoLike
    const hairlines = options.upscaleFilter === 'ridge' && (textured || !photoLike || flatFraction(image) >= PHOTO_FLAT_FRACTION)
    let spare: Uint8ClampedArray | undefined
    lap('downscale')

    // 2. Denoise at (near) source resolution, before upsampling spreads noise.
    // JPEG ringing/mosquito noise concentrates right at edges, where a global
    // noise estimate barely sees it, so the format hint forces cleanup.
    const lossy = options.sourceFormat === 'jpeg'
    const noiseSigma = estimateNoiseSigma(image)
    const denoise = options.denoise === 'on' || (options.denoise === 'auto' && (lossy || noiseSigma > 1.2))
    if (lossy) {
      const previous = image
      image = restoreJpegChroma(previous)
      if (reusable(previous)) spare = previous.data
    }
    if (denoise) {
      const previous = image
      image = bilateralDenoise(previous, 2, Math.max(lossy ? 22 : 14, 3.5 * noiseSigma), spare)
      spare = reusable(previous) ? previous.data : undefined
    }
    lap('denoise')

    // 3. Palette at source resolution: here anti-aliased edge pixels differ
    //    sharply from their neighbours, so the flat-pixel test cleanly excludes
    //    them (after upsampling, blends become smooth ramps that look "flat").
    const sourcePixels = sourceWidth * sourceHeight
    const speckleSource = options.speckleArea > 0 ? options.speckleArea : Math.max(2, Math.min(40, sourcePixels * 5e-6)) * (lossy ? 3 : 1)
    const baseN = image.width * image.height
    let baseOpaque = new Uint8Array(baseN)
    for (let p = 0; p < baseN; p++) if ((image.data[p * 4 + 3] ?? 0) >= options.alphaThreshold) baseOpaque[p] = 1
    let baseLab: OklabSource | null = new OklabSource(image.data)
    let baseFlat = computeFlatMask(image, baseLab, baseOpaque)
    const baseToSource = sourcePixels / baseN
    const palette = extractPalette(image, baseLab, baseOpaque, baseFlat, {
      mergeDistance: options.mergeDistance,
      maxColors: options.maxColors,
      minClusterFraction: Math.max(3e-5, (speckleSource * 2) / baseToSource / Math.max(1, baseN)),
      alphaThreshold: options.alphaThreshold,
      separation: options.paletteSeparation,
      inkSeedFraction: options.inkSeedFraction,
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
    const upscale = options.upscale > 0 ? Math.round(options.upscale) : autoUpscale(image.width, image.height, options.maxUpscaledPixels)
    const baseWidth = image.width
    const baseHeight = image.height
    if (upscale > 1) {
      const base = image
      image = gaussianBlur(upscaleBilinear(base, upscale), options.upscaleBlur * upscale)
      if (hairlines) restoreRidges(image, base, upscale, ridgeMask(base, options.ridgeThreshold))
    }
    else if (lossy) image = gaussianBlur(image, 0.5, spare)
    spare = undefined
    lap('upscale')

    const { width, height } = image
    const n = width * height
    // Without upsampling the base mask has the same size and is not needed
    // again: overwrite it instead of allocating a second one.
    let opaque = upscale > 1 ? new Uint8Array(n) : baseOpaque
    for (let p = 0; p < n; p++) opaque[p] = (image.data[p * 4 + 3] ?? 0) >= options.alphaThreshold ? 1 : 0
    // Without upsampling, colors come from the palette stage's image: for a
    // JPEG that is the sharper one before its light blur (ΔE 0.01-0.04 better
    // than the blurred one on the emblem JPEGs). From LAB_FROM_WORKING_PIXELS
    // the blurred working image is read instead, so the earlier buffer is
    // freed here (16 MB at 4 MP: a textured 4 MP emblem's peak 63 -> 47 MB).
    let lab: OklabSource | null = upscale > 1 || (lossy && n >= LAB_FROM_WORKING_PIXELS) ? new OklabSource(image.data) : baseLab
    baseLab = null
    let flat = upscaleMaskStrict(baseFlat, baseWidth, baseHeight, upscale)
    for (let p = 0; p < n; p++) if (!opaque[p]) flat[p] = 0
    lap('oklab')

    const sourceToWorking = (width / sourceWidth) * (height / sourceHeight)
    const minArea = Math.max(1, Math.round(speckleSource * sourceToWorking))
    let labels = labelPixels(image, lab, opaque, flat, palette, 2 * upscale + 1, options.mergeDistance * 2, options.thinFeatures ? upscale + 2 : 0, Math.max(1, Math.round(upscale * options.thinPeakScale)), textured)
    if (textured) regularizeLabels(labels, width, height, palette, lab, { beta: REGULARIZE_BETA, step: options.mergeDistance, passes: 3, maxSwitch: REGULARIZE_MAX_SWITCH })
    // Buffers are released right after their last use (memory at multi-MP sizes).
    baseOpaque = baseFlat = opaque = flat = NO_BYTES
    lap('label')

    // 5. Speckle cleanup and final regions.
    // One id buffer shared by every region pass (each would otherwise
    // allocate 4 bytes per pixel of garbage).
    const scratch = new Int32Array(n)
    // Detail is at least a few source pixels; a lone pixel is noise however much it contrasts.
    const protect = options.detailContrast > 0 ? { contrast: options.detailContrast, minArea: Math.max(2, minArea * options.detailAreaFraction, 3 * sourceToWorking) } : undefined
    labels = mergeSmallRegions(labels, width, height, palette, minArea, scratch, protect)
    labels = dissolveBlendSlivers(labels, width, height, palette, lab, 0.75 * Math.sqrt(sourceToWorking), scratch)
    const refine = options.shadingStep > 0
    if (!refine) {
      lab = null
      if (!options.gradients) image = NO_IMAGE
    }
    labels = mergeSmallRegions(labels, width, height, palette, minArea, scratch, protect)
    let regions = connectedComponents(labels, width, height, scratch)
    const regionsAfterSpeckle = regions.count
    let budgetPasses = 0
    // Region budget: pathological inputs (pure noise, dithering, halftones)
    // would otherwise produce tens of thousands of paths and megabyte SVGs.
    // Coarsen speckle removal until the region count is sane.
    //
    // On regular dense patterns (a fine checkerboard, pinstripes) one pass
    // cascades instead: recoloring a small square joins the neighbours of
    // the new color through it, until the image is a single shape. Such a
    // pass (from over budget to under a quarter of it at once) is undone,
    // and the detailed result is kept, up to maxRegionsHard regions: a
    // 2000² 16 px checkerboard (31k regions) peaks at ~51 MB live, an 8 px
    // one (125k) at ~122 MB, so beyond the hard cap the cascade is accepted.
    //
    // Detail first: passes up to BUDGET_DETAIL_FACTOR × the speckle area keep
    // small regions that contrast with their neighbour (detail protection),
    // so texture and shading fragments go before text and line art; only if
    // that misses the budget do plain passes restart from the speckle area.
    // Merging every small region alike erased the eagle of a shaded emblem
    // at 2000 px (BENCHMARKS.md "Content classes").
    let budgetArea = minArea
    let detailFirst = protect !== undefined
    while (regions.count > options.maxRegions && budgetArea < n / 50) {
      budgetArea *= 2
      if (detailFirst && budgetArea > minArea * BUDGET_DETAIL_FACTOR) {
        detailFirst = false
        budgetArea = minArea * 2
      }
      budgetPasses++
      const undo = regions.count <= options.maxRegionsHard ? labels.slice() : null
      const countBefore = regions.count
      labels = mergeSmallRegions(labels, width, height, palette, budgetArea, scratch, detailFirst ? protect : undefined)
      regions = connectedComponents(labels, width, height, scratch)
      if (undo && regions.count < options.maxRegions / 4) {
        labels = undo
        regions = connectedComponents(labels, width, height, scratch)
        console.warn(`Region budget: a merge pass collapsed ${countBefore} regions to fewer than ${Math.ceil(options.maxRegions / 4)}; kept the detailed result`)
        break
      }
    }
    lap('regions')

    // 5b. Gradient reconstruction: merge posterized bands back into regions
    //     filled with fitted linear gradients (labels >= palette.length).
    //     With shading refinement (5c) still to add palette colors, gradient
    //     groups are labeled past room for them and renumbered afterwards.
    let gradientFills: GradientFill[] = []
    let gradientGroupsFound = 0
    const coarsePaletteSize = palette.length
    const gradientBase = coarsePaletteSize + (refine ? MAX_SHADING_COLORS : 0)
    if (options.gradients && regions.count > 1) {
      const detected = detectGradients(image, regions.ids, regions.count, (r) => regions.labels[r] === TRANSPARENT_LABEL, {
        maxResidual: 0.02,
        minRamp: 0.08,
        minRegionRamp: 0.02,
        minArea: minArea * 4,
        edgeMargin: Math.ceil(1.5 * upscale) + 1,
        maxBoundaryStep: options.gradientBoundaryStep > 0 ? options.gradientBoundaryStep : undefined,
        radialCenterSearch: options.radialCenterSearch,
      })
      gradientGroupsFound = detected.fills.length
      const gradient = validateGradientGroups(image, regions.ids, regions.count, (r) => {
        const color = palette[regions.labels[r]!]
        return color ? [color.r, color.g, color.b] : null
      }, detected)
      if (gradient.fills.length > 0) {
        for (let p = 0; p < n; p++) {
          const g = gradient.groupOfRegion[regions.ids[p]!]!
          if (g >= 0) labels[p] = gradientBase + g
        }
        regions = connectedComponents(labels, width, height, scratch)
        gradientFills = gradient.fills
      }
    }
    lap('gradients')

    // 5c. Shading refinement (refine.ts): shaded regions that did not become
    //     gradients are re-quantized into finer levels inside their interior;
    //     level fragments under the speckle area join neighbouring levels.
    let shadedRegions = 0
    if (refine && lab && regions.count < options.maxRegions) {
      const minLevel = Math.max(minArea * 2, 8 * upscale * upscale)
      shadedRegions = refineShading(labels, regions.ids, regions.count, regions.labels, image, lab, palette, {
        step: options.shadingStep,
        margin: Math.max(Math.ceil(1.5 * upscale) + 1, Math.round(2.5 * Math.sqrt(sourceToWorking))),
        minInterior: minArea * 8,
        minLevel,
        maxNewColors: MAX_SHADING_COLORS,
        maxLevels: options.maxRegions - regions.count,
        maxColorDistance: 2 * options.mergeDistance,
        smoothRadius: upscale,
      })
      // Levels are bands across shaded areas; small islands of a level are
      // noise or texture lifted by the finer steps, and rejoin a neighbouring level.
      if (shadedRegions > 0) {
        const levels = palette.length
        labels = mergeSmallRegions(labels, width, height, palette, minLevel * 2, scratch, undefined, (label) => label >= coarsePaletteSize && label < levels)
        // Drop levels left without pixels and renumber the rest.
        const used = new Uint8Array(levels - coarsePaletteSize)
        for (let p = 0; p < n; p++) {
          const label = labels[p]!
          if (label >= coarsePaletteSize && label < levels) used[label - coarsePaletteSize] = 1
        }
        const remap = new Int32Array(used.length)
        let next = coarsePaletteSize
        for (let i = 0; i < used.length; i++) {
          remap[i] = next
          if (used[i]) palette[next++] = palette[coarsePaletteSize + i]!
        }
        palette.length = next
        for (let p = 0; p < n; p++) {
          const label = labels[p]!
          if (label >= coarsePaletteSize && label < levels) labels[p] = remap[label - coarsePaletteSize]!
        }
      }
    }
    lab = null
    if (gradientFills.length > 0 && palette.length < gradientBase) {
      const shift = gradientBase - palette.length
      for (let p = 0; p < n; p++) if (labels[p]! >= gradientBase) labels[p] = labels[p]! - shift
    }
    if (shadedRegions > 0 || (gradientFills.length > 0 && refine)) regions = connectedComponents(labels, width, height, scratch)
    lap('shading')

    image = NO_IMAGE
    labels = NO_POINTS

    // 6. Shared boundaries and curve fitting.
    const chains = extractChains(regions.ids, width, height)
    regions.ids = NO_POINTS
    const boundaries = buildRegionBoundaries(chains, regions.count)
    lap('chains')
    const diagnostics: TraceDiagnostics = { flatFraction: inputFlatFraction, contentClass, photoCap, minArea, regionsAfterSpeckle, budgetPasses, budgetArea, gradientGroupsFound, shadedRegions }
    return { width, height, upscale, denoise, noiseSigma, sourceToWorking, coordinateScale: baseScale / upscale, palette, regionLabels: regions.labels, regionCount: regions.count, chains, boundaries, gradientFills, diagnostics }
  })()
  const { width, height, upscale, denoise, noiseSigma, sourceToWorking, coordinateScale, palette, chains, boundaries, gradientFills, diagnostics } = seg
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
  const scale = coordinateScale
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
      diagnostics,
      timingsMs: timings,
    },
  }
}
