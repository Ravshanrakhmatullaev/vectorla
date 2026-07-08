import type { TracePresetName } from './tracePresets'

export interface ImageAnalysis {
  /** Distinct-color estimate after quantizing to reduce compression/anti-aliasing noise — not an exact count. */
  colorCountEstimate: number
  hasTransparency: boolean
  /** 0 (flat, simple) – 1 (highly detailed/noisy), combining color variety and edge density. */
  complexityScore: number
  recommendedPreset: TracePresetName
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

/** Perceptual-ish luma, cheap enough for a per-sample loop. */
function luma(r: number, g: number, b: number): number {
  return 0.299 * r + 0.587 * g + 0.114 * b
}

/**
 * Estimates color variety, transparency, and visual complexity from decoded
 * pixels, then recommends a trace preset (see tracePresets.ts). Heuristic,
 * not exact — good enough to pick a reasonable default when the caller
 * didn't request a specific preset (see PlaceholderProvider.vectorize).
 */
export function analyzeImage(imageData: ImageData): ImageAnalysis {
  const { width, height, data } = imageData
  const totalPixels = width * height
  const stride = Math.max(1, Math.floor(Math.sqrt(totalPixels / MAX_SAMPLES)))

  const quantizedColors = new Set<number>()
  let transparentSamples = 0
  let edgeSamples = 0
  let comparedSamples = 0
  let sampleCount = 0
  let previousLuma: number | null = null

  for (let y = 0; y < height; y += stride) {
    previousLuma = null // don't compare across a row boundary
    for (let x = 0; x < width; x += stride) {
      const i = (y * width + x) * 4
      const r = data[i] ?? 0
      const g = data[i + 1] ?? 0
      const b = data[i + 2] ?? 0
      const a = data[i + 3] ?? 255
      sampleCount++

      if (a < TRANSPARENCY_ALPHA_THRESHOLD) transparentSamples++

      const quantized =
        (Math.round(r / QUANTIZE_STEP) << 16) | (Math.round(g / QUANTIZE_STEP) << 8) | Math.round(b / QUANTIZE_STEP)
      quantizedColors.add(quantized)

      const currentLuma = luma(r, g, b)
      if (previousLuma !== null) {
        comparedSamples++
        if (Math.abs(currentLuma - previousLuma) > 24) edgeSamples++
      }
      previousLuma = currentLuma
    }
  }

  const hasTransparency = sampleCount > 0 && transparentSamples / sampleCount >= TRANSPARENCY_MIN_FRACTION
  const colorVarietyRatio = sampleCount > 0 ? Math.min(1, quantizedColors.size / sampleCount) : 0
  const edgeDensity = comparedSamples > 0 ? edgeSamples / comparedSamples : 0
  const complexityScore = Math.min(1, colorVarietyRatio * 0.5 + edgeDensity * 0.5)

  return {
    colorCountEstimate: quantizedColors.size,
    hasTransparency,
    complexityScore,
    recommendedPreset: recommendPreset(quantizedColors.size, hasTransparency, complexityScore),
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
