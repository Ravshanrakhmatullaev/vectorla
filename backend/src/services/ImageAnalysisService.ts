import type { Upload } from '../types'
import type { VectorizationProviderName } from '../providers/VectorizationProvider'
import { decodeImage, type RasterDecoderWasm } from '../providers/imageDecoder'
import { analyzeImage, type ImageAnalysis } from '../providers/imageAnalysis'
import { selectProvider, type ImageType } from '../providers/ProviderSelector'
import type { TracePresetName } from '../providers/tracePresets'
import { CREDIT_COST_BASE_CONVERSION } from '../config'

export type { ImageType }
export type EstimatedQuality = 'high' | 'medium' | 'low'

/**
 * Full result of analyzing an uploaded image before vectorization (Phase 21).
 * Computed twice per job by design, not persisted: once at upload time (see
 * routes/uploads.ts, so the frontend gets it immediately) and once again
 * inside ConversionService.processJob (to actually pick a provider) — both
 * calls are cheap and stateless, so this avoids a Supabase schema change for
 * a field nothing else needs to query later.
 */
export interface ImageAnalysisResult {
  width: number
  height: number
  aspectRatio: number
  colorCountEstimate: number
  hasAlphaChannel: boolean
  hasTransparency: boolean
  /** Up to 5 approximate hex colors, most-frequent first. */
  dominantColors: string[]
  edgeDensity: number
  noiseLevel: number
  isGrayscale: boolean
  /** Coarse 3-way classification driving ProviderSelector — see providers/ProviderSelector.ts. */
  imageType: ImageType
  complexityScore: number
  recommendedProvider: VectorizationProviderName
  /** The ImageTracer trace preset PlaceholderProvider would auto-recommend, exposed for callers that want the finer-grained (5-way) signal too. */
  recommendedTracePreset: TracePresetName
  estimatedQuality: EstimatedQuality
  /** Heuristic credit estimate for display only — CreditsService.ensureEnoughCredits is still the actual enforcement, unaffected by this. */
  estimatedCredits: number
  /** Heuristic processing-time estimate in ms, for display only — never measured. */
  estimatedProcessingTimeMs: number
}

// AI-tier providers ('vision'/'openai') are still stubs (see ProviderSelector's
// doc comment) — this only shapes the *estimate* shown to the user ahead of
// time, it doesn't change what CreditsService actually charges today.
const AI_PROVIDER_CREDIT_MULTIPLIER = 2
const AI_PROVIDER_TIME_ESTIMATE_MS = 4000

const BASE_PROCESSING_TIME_MS = 150
const PIXELS_PER_PROCESSING_MS = 4000
const LOW_RESOLUTION_PIXEL_COUNT = 64 * 64
const HIGH_COMPLEXITY_FOR_FLAT_TRACING = 0.75
const VERY_HIGH_COMPLEXITY = 0.85

function toImageType(preset: TracePresetName): ImageType {
  if (preset === 'photo') return 'photo'
  if (preset === 'illustration') return 'illustration'
  return 'logo' // 'logo' | 'icon' | 'sticker' — all flat-color mark variants
}

/**
 * ImageTracer/Potrace are flat-color tracing engines — they don't handle
 * high detail/noise as gracefully as a real photo-vectorization model would.
 * "quality" here means "how good the *chosen* provider's output is likely to
 * be for this input", not an absolute image-quality score.
 */
function estimateQuality(pixelCount: number, complexityScore: number, imageType: ImageType): EstimatedQuality {
  if (pixelCount < LOW_RESOLUTION_PIXEL_COUNT) return 'low'
  if (imageType === 'photo') return complexityScore >= VERY_HIGH_COMPLEXITY ? 'low' : 'medium'
  if (complexityScore >= HIGH_COMPLEXITY_FOR_FLAT_TRACING) return 'medium'
  return 'high'
}

function estimateCredits(recommendedProvider: VectorizationProviderName): number {
  const isAiTier = recommendedProvider === 'vision' || recommendedProvider === 'openai'
  return isAiTier ? CREDIT_COST_BASE_CONVERSION * AI_PROVIDER_CREDIT_MULTIPLIER : CREDIT_COST_BASE_CONVERSION
}

function estimateProcessingTimeMs(pixelCount: number, recommendedProvider: VectorizationProviderName): number {
  const isAiTier = recommendedProvider === 'vision' || recommendedProvider === 'openai'
  if (isAiTier) return AI_PROVIDER_TIME_ESTIMATE_MS
  return Math.round(BASE_PROCESSING_TIME_MS + pixelCount / PIXELS_PER_PROCESSING_MS)
}

export class ImageAnalysisService {
  constructor(private readonly wasm: RasterDecoderWasm) {}

  async analyze(upload: Upload, fileBytes: ArrayBuffer): Promise<ImageAnalysisResult> {
    const imageData = await decodeImage(upload.mimeType, fileBytes, this.wasm)
    const base: ImageAnalysis = analyzeImage(imageData)

    const imageType = toImageType(base.recommendedPreset)
    const recommendedProvider = selectProvider({ imageType, isGrayscale: base.isGrayscale })
    const pixelCount = imageData.width * imageData.height

    return {
      width: imageData.width,
      height: imageData.height,
      aspectRatio: imageData.height > 0 ? imageData.width / imageData.height : 1,
      colorCountEstimate: base.colorCountEstimate,
      hasAlphaChannel: base.hasAlphaChannel,
      hasTransparency: base.hasTransparency,
      dominantColors: base.dominantColors,
      edgeDensity: base.edgeDensity,
      noiseLevel: base.noiseLevel,
      isGrayscale: base.isGrayscale,
      imageType,
      complexityScore: base.complexityScore,
      recommendedProvider,
      recommendedTracePreset: base.recommendedPreset,
      estimatedQuality: estimateQuality(pixelCount, base.complexityScore, imageType),
      estimatedCredits: estimateCredits(recommendedProvider),
      estimatedProcessingTimeMs: estimateProcessingTimeMs(pixelCount, recommendedProvider),
    }
  }
}

export function createImageAnalysisService(wasm: RasterDecoderWasm): ImageAnalysisService {
  return new ImageAnalysisService(wasm)
}
