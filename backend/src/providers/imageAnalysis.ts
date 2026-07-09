import type { TracePresetName } from './tracePresets'

export interface ImageAnalysis {
  /** Distinct-color estimate after quantizing to reduce compression/anti-aliasing noise — not an exact count. */
  colorCountEstimate: number
  hasTransparency: boolean
  /** 0 (flat, simple) – 1 (highly detailed/noisy), combining color variety and edge density. */
  complexityScore: number
  recommendedPreset: TracePresetName
  /** True if any sampled pixel has alpha < 255 at all — looser than hasTransparency, which requires a meaningful fraction (see TRANSPARENCY_MIN_FRACTION). */
  hasAlphaChannel: boolean
  /** Fraction of sampled adjacent pairs whose luma jumps by an "edge"-sized amount — same signal PlaceholderProvider's preset choice already used, exposed directly for ImageAnalysisService (Phase 21). */
  edgeDensity: number
  /** 0–1 heuristic: small, sign-flipping luma jitter (unlike a real edge/gradient, which moves the same direction for a run) — a proxy for sensor/compression noise, not an exact measurement. */
  noiseLevel: number
  /** True if nearly every sampled pixel's R/G/B channels are within a few levels of each other. */
  isGrayscale: boolean
  /** Up to 5 approximate hex colors, most-frequent first (dequantized from the same histogram as colorCountEstimate). */
  dominantColors: string[]
}

// Quantizing each channel to 32 buckets (8 bits -> 5 bits) collapses
// compression artifacts/anti-aliasing gradients into "the same" color for
// counting purposes, without this being an exact/perceptual color model.
const QUANTIZE_STEP = 8

// Caps how many pixels get inspected — a 4000x4000 upload has 16M pixels;
// analysis only needs a representative sample, not every one, to stay fast.
const MAX_SAMPLES = 10_000

const TRANSPARENCY_ALPHA_THRESHOLD = 250
const TRANSPARENCY_MIN_FRACTION = 0.01

const EDGE_LUMA_DELTA = 24
// Noise is a real luma change, but a small one — big enough to not be flat-
// region rounding, small enough that a genuine edge/gradient wouldn't sit here.
const NOISE_LUMA_DELTA_MIN = 4
const NOISE_LUMA_DELTA_MAX = EDGE_LUMA_DELTA

const GRAYSCALE_CHANNEL_SPREAD = 10
const GRAYSCALE_FRACTION_THRESHOLD = 0.97

const DOMINANT_COLOR_LIMIT = 5

/** Perceptual-ish luma, cheap enough for a per-sample loop. */
function luma(r: number, g: number, b: number): number {
  return 0.299 * r + 0.587 * g + 0.114 * b
}

function toHex(quantized: number): string {
  const rq = (quantized >> 16) & 0xff
  const gq = (quantized >> 8) & 0xff
  const bq = quantized & 0xff
  const channel = (q: number) => Math.min(255, q * QUANTIZE_STEP).toString(16).padStart(2, '0')
  return `#${channel(rq)}${channel(gq)}${channel(bq)}`
}

/**
 * Estimates color variety, transparency, visual complexity, grayscale-ness,
 * and noise from decoded pixels in a single pass, then recommends a trace
 * preset (see tracePresets.ts). Heuristic, not exact — good enough to pick a
 * reasonable default when the caller didn't request a specific preset (see
 * PlaceholderProvider.vectorize) and to feed ImageAnalysisService's coarser
 * classification (Phase 21 — see services/ImageAnalysisService.ts).
 */
export function analyzeImage(imageData: ImageData): ImageAnalysis {
  const { width, height, data } = imageData
  const totalPixels = width * height
  const stride = Math.max(1, Math.floor(Math.sqrt(totalPixels / MAX_SAMPLES)))

  const colorFrequency = new Map<number, number>()
  let transparentSamples = 0
  let alphaSamples = 0
  let grayscaleSamples = 0
  let edgeSamples = 0
  let noiseSamples = 0
  let comparedSamples = 0
  let sampleCount = 0
  let previousLuma: number | null = null
  let previousDeltaSign = 0

  for (let y = 0; y < height; y += stride) {
    previousLuma = null // don't compare across a row boundary
    previousDeltaSign = 0
    for (let x = 0; x < width; x += stride) {
      const i = (y * width + x) * 4
      const r = data[i] ?? 0
      const g = data[i + 1] ?? 0
      const b = data[i + 2] ?? 0
      const a = data[i + 3] ?? 255
      sampleCount++

      if (a < 255) alphaSamples++
      if (a < TRANSPARENCY_ALPHA_THRESHOLD) transparentSamples++
      if (Math.max(r, g, b) - Math.min(r, g, b) <= GRAYSCALE_CHANNEL_SPREAD) grayscaleSamples++

      const quantized =
        (Math.round(r / QUANTIZE_STEP) << 16) | (Math.round(g / QUANTIZE_STEP) << 8) | Math.round(b / QUANTIZE_STEP)
      colorFrequency.set(quantized, (colorFrequency.get(quantized) ?? 0) + 1)

      const currentLuma = luma(r, g, b)
      if (previousLuma !== null) {
        comparedSamples++
        const delta = currentLuma - previousLuma
        const magnitude = Math.abs(delta)
        if (magnitude > EDGE_LUMA_DELTA) edgeSamples++
        const deltaSign = Math.sign(delta)
        if (
          magnitude >= NOISE_LUMA_DELTA_MIN &&
          magnitude <= NOISE_LUMA_DELTA_MAX &&
          previousDeltaSign !== 0 &&
          deltaSign !== 0 &&
          deltaSign !== previousDeltaSign
        ) {
          noiseSamples++
        }
        if (deltaSign !== 0) previousDeltaSign = deltaSign
      }
      previousLuma = currentLuma
    }
  }

  const hasTransparency = sampleCount > 0 && transparentSamples / sampleCount >= TRANSPARENCY_MIN_FRACTION
  const hasAlphaChannel = alphaSamples > 0
  const isGrayscale = sampleCount > 0 && grayscaleSamples / sampleCount >= GRAYSCALE_FRACTION_THRESHOLD
  const colorVarietyRatio = sampleCount > 0 ? Math.min(1, colorFrequency.size / sampleCount) : 0
  const edgeDensity = comparedSamples > 0 ? edgeSamples / comparedSamples : 0
  const noiseLevel = comparedSamples > 0 ? noiseSamples / comparedSamples : 0
  const complexityScore = Math.min(1, colorVarietyRatio * 0.5 + edgeDensity * 0.5)

  const dominantColors = Array.from(colorFrequency.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, DOMINANT_COLOR_LIMIT)
    .map(([quantized]) => toHex(quantized))

  return {
    colorCountEstimate: colorFrequency.size,
    hasTransparency,
    complexityScore,
    recommendedPreset: recommendPreset(colorFrequency.size, hasTransparency, complexityScore),
    hasAlphaChannel,
    edgeDensity,
    noiseLevel,
    isGrayscale,
    dominantColors,
  }
}

function recommendPreset(colorCountEstimate: number, hasTransparency: boolean, complexityScore: number): TracePresetName {
  // Ordered from the most distinctive signal down to the safest fallback
  // (this product's primary use case — see PROJECT_CONTEXT.md — is logos).
  if (complexityScore >= 0.6) return 'photo'
  if (colorCountEstimate > 32) return 'illustration'
  if (hasTransparency && colorCountEstimate <= 16) return 'sticker'
  if (colorCountEstimate <= 6 && complexityScore < 0.2) return 'icon'
  return 'logo'
}
