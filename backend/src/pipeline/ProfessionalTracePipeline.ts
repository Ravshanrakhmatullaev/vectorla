import type { VectorizationProviderName } from '../providers/VectorizationProvider'
import type { TracePresetName } from '../providers/tracePresets'
import { analyzeImage, type ImageAnalysis } from '../providers/imageAnalysis'
import { traceOwnedImage, type TraceEngineStats } from '../engine/traceImage'
import type { DecodedForTrace } from '../providers/imageDecoder'
import { engineOptionsFor, type SourceFormat } from '../engine/profiles'

/**
 * Quick and Professional Trace, both on the Vectorla engine (src/engine/).
 *
 * The previous implementation ran six whole-image filters (box blur,
 * border-color flattening, auto-levels, uniform RGB quantization, unsharp
 * mask) before ImageTracer. Measured with the render-and-diff benchmark
 * (BENCHMARKS.md) those stages made Professional output far worse than
 * Quick — ~6 px mean edge error vs 0.4 px — because uniform quantization and
 * auto-levels shift colors and edges before tracing even starts. The engine
 * now does the equivalent work in-model (edge-preserving denoise, perceptual
 * palette, AA-aware labeling, super-sampling), so the modes differ only in
 * how much resolution and palette they are allowed to use.
 */

/**
 * Sentinel Job.preset value that opts a job into Professional Trace (see
 * ConversionService.processJob). Not a TracePresetName — isTracePresetName
 * rejects it — and Job.preset already accepts any string.
 */
export const PROFESSIONAL_TRACE_JOB_PRESET = 'professional'

/** How many times the base credit cost a Professional Trace job is charged. */
export const PROFESSIONAL_TRACE_CREDIT_MULTIPLIER = 2

/** One engine stage's measured contribution to a run. */
export interface StageTiming {
  name: string
  durationMs: number
  enabled: boolean
}

export interface PipelineResult {
  svg: string
  provider: VectorizationProviderName
  /** The content profile image analysis recommends — informational (logging/UI). */
  tracePreset: TracePresetName
  analysis: ImageAnalysis
  stageTimings: StageTiming[]
  totalTimeMs: number
  engine: TraceEngineStats
}

export type TraceMode = 'quick' | 'professional'

export function runTracePipeline(imageData: ImageData, mode: TraceMode, sourceFormat: SourceFormat = 'unknown'): PipelineResult {
  const decoded: DecodedForTrace = { image: imageData, sourceSize: { width: imageData.width, height: imageData.height } }
  return runDecodedTracePipeline(decoded, analyzeImage(imageData), mode, sourceFormat)
}

/**
 * The pipeline for an upload decoded with decodeForTrace: `analysis` was
 * taken from the full-resolution image, which is no longer held.
 */
export function runDecodedTracePipeline(decoded: DecodedForTrace, analysis: ImageAnalysis, mode: TraceMode, sourceFormat: SourceFormat = 'unknown'): PipelineResult {
  const start = performance.now()
  const result = traceOwnedImage(decoded, { ...engineOptionsFor(mode), sourceFormat, sourceSize: decoded.sourceSize })
  const stageTimings: StageTiming[] = Object.entries(result.stats.timingsMs).map(([name, durationMs]) => ({ name, durationMs, enabled: true }))
  return {
    svg: result.svg,
    provider: 'vectorla',
    tracePreset: analysis.recommendedPreset,
    analysis,
    stageTimings,
    totalTimeMs: performance.now() - start,
    engine: result.stats,
  }
}

export function runProfessionalTrace(imageData: ImageData, sourceFormat: SourceFormat = 'unknown'): PipelineResult {
  return runTracePipeline(imageData, 'professional', sourceFormat)
}

export function runQuickTrace(imageData: ImageData, sourceFormat: SourceFormat = 'unknown'): PipelineResult {
  return runTracePipeline(imageData, 'quick', sourceFormat)
}
