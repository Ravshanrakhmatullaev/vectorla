import type { PipelineStage } from '../PipelineStage'
import { analyzeImage, type ImageAnalysis } from '../../providers/imageAnalysis'
import { selectProvider } from '../../providers/ProviderSelector'
import { selectTracePreset } from '../../providers/tracePresetSelector'
import { toImageType } from '../../services/ImageAnalysisService'
import { TRACE_PRESETS, isTracePresetName, type TracePresetName } from '../../providers/tracePresets'
import type { VectorizationProviderName } from '../../providers/VectorizationProvider'
import { POTRACE_OPTIONS } from '../../providers/PotraceProvider'
import { NotImplementedError } from '../../errors'
import ImageTracer from 'imagetracerjs'
import { imageDataToBitmap, traceBitmap, getSVG, calculateAutoThreshold } from '@cadit-app/potrace-ts'

export interface ProviderSelectionResult {
  rawSvg: string
  /** The provider that actually produced rawSvg — may differ from analysis.recommendedProvider if that one isn't implemented yet (see traceWithProvider's fallback). */
  provider: VectorizationProviderName
  tracePreset: TracePresetName
  analysis: ImageAnalysis
}

/**
 * Runs the same analysis + selection logic ConversionService/ImageAnalysisService
 * use in the non-pipeline path (reused, not reimplemented — see
 * providers/ProviderSelector.ts and providers/tracePresetSelector.ts), then
 * actually traces the (by this point, preprocessed) ImageData directly —
 * bypassing the byte-based VectorizationProvider.vectorize() interface
 * entirely, since re-encoding back to file bytes just to have a provider
 * re-decode them would be pure waste. ImageTracer/Potrace's own
 * ImageData-level APIs (ImageTracer.imagedataToSVG /
 * imageDataToBitmap+traceBitmap+getSVG) are called directly instead.
 *
 * Vision/OpenAI are still stubs (see ProviderSelector.ts) — same
 * NotImplementedError -> ImageTracer fallback pattern as
 * ConversionService.processJob.
 */
export class ProviderSelectionStage implements PipelineStage<ImageData, ProviderSelectionResult> {
  readonly name = 'provider-selection'

  process(input: ImageData): ProviderSelectionResult {
    const analysis = analyzeImage(input)
    const imageType = toImageType(analysis.recommendedPreset)
    const recommendedProvider = selectProvider({ imageType, isGrayscale: analysis.isGrayscale })
    const aspectRatio = input.height > 0 ? input.width / input.height : 1
    const tracePreset = selectTracePreset({
      imageType,
      isGrayscale: analysis.isGrayscale,
      hasTransparency: analysis.hasTransparency,
      colorCountEstimate: analysis.colorCountEstimate,
      complexityScore: analysis.complexityScore,
      edgeDensity: analysis.edgeDensity,
      noiseLevel: analysis.noiseLevel,
      aspectRatio,
    })

    try {
      const rawSvg = traceWithProvider(input, recommendedProvider, tracePreset)
      return { rawSvg, provider: recommendedProvider, tracePreset, analysis }
    } catch (error) {
      if (!(error instanceof NotImplementedError)) throw error
      const rawSvg = traceWithProvider(input, 'placeholder', tracePreset)
      return { rawSvg, provider: 'placeholder', tracePreset, analysis }
    }
  }
}

function traceWithProvider(imageData: ImageData, provider: VectorizationProviderName, tracePreset: TracePresetName): string {
  switch (provider) {
    case 'placeholder': {
      const options = isTracePresetName(tracePreset) ? TRACE_PRESETS[tracePreset] : TRACE_PRESETS.logo
      return ImageTracer.imagedataToSVG(imageData, options)
    }
    case 'potrace': {
      const threshold = calculateAutoThreshold(imageData)
      const bitmap = imageDataToBitmap(imageData, threshold)
      const paths = traceBitmap(bitmap, POTRACE_OPTIONS)
      return getSVG(paths, 1)
    }
    case 'vision':
    case 'openai':
      throw new NotImplementedError(`Provider "${provider}" is not implemented yet`)
  }
}
