import type { TracePresetName } from './tracePresets'

export type TracePresetImageType = 'photo' | 'illustration' | 'logo'

/**
 * The subset of ImageAnalysisResult (see services/ImageAnalysisService.ts)
 * this selector actually reasons about — kept as its own small interface
 * (not importing ImageAnalysisResult directly) so this file has no
 * dependency on the service layer, same pattern as ProviderSelector.ts.
 */
export interface TracePresetSelectionInput {
  imageType: TracePresetImageType
  isGrayscale: boolean
  hasTransparency: boolean
  colorCountEstimate: number
  complexityScore: number
  edgeDensity: number
  noiseLevel: number
  aspectRatio: number
}

// Hand-drawn pencil/charcoal work has real per-pixel texture a clean
// technical drawing or a signature scan doesn't.
const SKETCH_MIN_NOISE_LEVEL = 0.15

// QR/barcode-style codes: near-binary color count, square, and (measured
// against tracePresets.smoke-test.ts's synthetic QR/low-res-logo/icon
// samples — complexityScore turned out too close to zero across the board
// at full-resolution sampling to be useful here, so this leans on
// edgeDensity instead) enough hard transitions per sampled pixel to sit
// above every other flat-mark category tested, but not by a huge margin —
// this is the most fragile threshold in this file; a real QR photographed
// at a very different resolution/module count could easily land under it.
const QR_MAX_COLORS = 4
const QR_MIN_EDGE_DENSITY = 0.065
const QR_MIN_ASPECT_RATIO = 0.85
const QR_MAX_ASPECT_RATIO = 1.15

// Technical line-work (blueprints, diagrams): low color count, and —
// measured to be a far more reliable signal than edge density or
// complexity at this sample size — usually drawn on a non-square canvas,
// unlike the square logo/icon/QR marks in this product's test set.
const BLUEPRINT_MAX_COLORS = 6
const BLUEPRINT_MIN_ASPECT_RATIO = 1.2
const BLUEPRINT_MAX_ASPECT_RATIO = 1 / BLUEPRINT_MIN_ASPECT_RATIO

const STICKER_MAX_COLORS_WITH_TRANSPARENCY = 16
const ICON_MAX_COLORS = 6
const ICON_MAX_COMPLEXITY = 0.2

/**
 * Automatically picks one of the 9 named trace profiles (tracePresets.ts,
 * Phase 23) from ImageAnalysisResult's signals. Heuristic, not exact —
 * these pixel-level statistics can't perfectly tell a technical drawing
 * from a sketch or a signature apart the way a human would, and every
 * threshold below was calibrated against the synthetic samples in
 * testSupport/qualityTestImages.ts (see tracePresets.smoke-test.ts), not a
 * large real-world corpus. Deliberately separate from ProviderSelector.ts
 * (which only needs the coarse 3-way imageType/isGrayscale split to pick a
 * *provider*) — this picks the fine-grained *trace profile* within
 * whichever provider ends up running.
 */
export function selectTracePreset(input: TracePresetSelectionInput): TracePresetName {
  const { imageType, isGrayscale, hasTransparency, colorCountEstimate, complexityScore, edgeDensity, noiseLevel, aspectRatio } = input

  // Photographs are handled by the (future) AI pipeline — see
  // ProviderSelector.ts — but ImageTracer still needs a fallback profile for
  // when that provider isn't implemented yet (ConversionService's
  // NotImplementedError catch).
  if (imageType === 'photo') return 'photo'

  // Gated on grayscale so a noisy *colored* source (e.g. a real photograph
  // that this heuristic classified as 'illustration' rather than 'photo')
  // doesn't get undercolored by sketch's small 8-color palette.
  if (isGrayscale && noiseLevel >= SKETCH_MIN_NOISE_LEVEL) return 'sketch'

  if (imageType === 'illustration') return 'illustration'

  // From here on imageType is 'logo' (flat, few colors) — refine into the
  // finer-grained mark types this phase adds.

  // Sparse, thin ink on a background that's actually see-through (a scanned
  // signature) — grayscale ink is the norm, real transparency is the
  // distinguishing signal versus every other flat-color category here.
  if (isGrayscale && hasTransparency) return 'signature'

  if (
    isGrayscale &&
    colorCountEstimate <= QR_MAX_COLORS &&
    edgeDensity >= QR_MIN_EDGE_DENSITY &&
    aspectRatio >= QR_MIN_ASPECT_RATIO &&
    aspectRatio <= QR_MAX_ASPECT_RATIO
  ) {
    return 'qrCode'
  }

  if (colorCountEstimate <= BLUEPRINT_MAX_COLORS && (aspectRatio >= BLUEPRINT_MIN_ASPECT_RATIO || aspectRatio <= BLUEPRINT_MAX_ASPECT_RATIO)) {
    return 'blueprint'
  }

  if (hasTransparency && colorCountEstimate <= STICKER_MAX_COLORS_WITH_TRANSPARENCY) return 'sticker'
  if (colorCountEstimate <= ICON_MAX_COLORS && complexityScore < ICON_MAX_COMPLEXITY) return 'icon'
  return 'logo'
}
