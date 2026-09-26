import type { VectorizationProviderName } from '../providers/VectorizationProvider'
import type { TracePresetName } from '../providers/tracePresets'
import { analyzeImage, type ImageAnalysis } from '../providers/imageAnalysis'
import { traceImage, type TraceEngineStats } from '../engine/traceImage'
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
  const start = performance.now()
  const analysis = analyzeImage(imageData)
  const result = traceImage(imageData, { ...engineOptionsFor(mode), sourceFormat })
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
