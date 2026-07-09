import type { PipelineStage, StageTiming } from './PipelineStage'
import { AutoUpscaleStage } from './stages/AutoUpscaleStage'
import { NoiseReductionStage } from './stages/NoiseReductionStage'
import { BackgroundCleanupStage } from './stages/BackgroundCleanupStage'
import { ContrastNormalizationStage } from './stages/ContrastNormalizationStage'
import { ColorQuantizationStage } from './stages/ColorQuantizationStage'
import { EdgeEnhancementStage } from './stages/EdgeEnhancementStage'
import { ProviderSelectionStage } from './stages/ProviderSelectionStage'
import { SvgOptimizationStage } from './stages/SvgOptimizationStage'
import type { VectorizationProviderName } from '../providers/VectorizationProvider'
import type { TracePresetName } from '../providers/tracePresets'
import type { ImageAnalysis } from '../providers/imageAnalysis'

/**
 * Which of the 6 image-domain preprocessing stages run (task requirement 3
 * — "Stages can be enabled/disabled individually"). Provider Selection and
 * SVG Optimization aren't toggleable here — they're not optional
 * preprocessing, they're how any trace actually happens at all.
 */
export interface PipelineStageConfig {
  autoUpscale: boolean
  noiseReduction: boolean
  backgroundCleanup: boolean
  contrastNormalization: boolean
  colorQuantization: boolean
  edgeEnhancement: boolean
}

/**
 * Professional Trace's default: every real preprocessing stage on.
 * autoUpscale defaults off — it's a documented no-op hook (see
 * AutoUpscaleStage.ts), not a real feature yet, so there's nothing to gain
 * from "running" it.
 */
export const DEFAULT_PIPELINE_CONFIG: PipelineStageConfig = {
  autoUpscale: false,
  noiseReduction: true,
  backgroundCleanup: true,
  contrastNormalization: true,
  colorQuantization: true,
  edgeEnhancement: true,
}

/** Quick Trace's config — every preprocessing stage off, so runQuickTrace (below) is provider selection + optimization only, on the untouched original pixels. */
export const QUICK_TRACE_CONFIG: PipelineStageConfig = {
  autoUpscale: false,
  noiseReduction: false,
  backgroundCleanup: false,
  contrastNormalization: false,
  colorQuantization: false,
  edgeEnhancement: false,
}

/**
 * Sentinel Job.preset value that opts a job into the full Professional
 * Trace pipeline instead of the normal Quick Trace flow — see
 * ConversionService.processJob. Not a TracePresetName (isTracePresetName
 * correctly rejects it), and Job.preset already accepts any string
 * unvalidated (see routes/jobs.ts), so this needs no route/schema changes
 * to be safe: nothing sends it yet, so existing behavior is completely
 * unaffected until a future phase wires the frontend to actually request it.
 */
export const PROFESSIONAL_TRACE_JOB_PRESET = 'professional'

/**
 * Phase 26: how many times CreditsService.calculateRequiredCredits' base
 * cost is charged for a Professional Trace job, on top of Quick Trace's
 * normal 1x — see ConversionService.processJob. Mirrors the multiplier
 * ImageAnalysisService already uses to *estimate* AI-tier provider cost
 * (AI_PROVIDER_CREDIT_MULTIPLIER), kept as its own constant here since that
 * one is about provider recommendation, not what this specific preset bills.
 */
export const PROFESSIONAL_TRACE_CREDIT_MULTIPLIER = 2

export interface PipelineResult {
  svg: string
  provider: VectorizationProviderName
  tracePreset: TracePresetName
  analysis: ImageAnalysis
  stageTimings: StageTiming[]
  totalTimeMs: number
}

interface PreprocessingStageEntry {
  configKey: keyof PipelineStageConfig
  stage: PipelineStage<ImageData, ImageData>
}

/**
 * Task requirement 4: "Professional Trace uses the pipeline. Quick Trace
 * bypasses preprocessing." Both are the exact same function — the only
 * difference is which PipelineStageConfig is passed in. Stage instances are
 * constructed fresh per call (not module-level singletons) since Cloudflare
 * Workers can reuse the same isolate across requests — shared mutable
 * `enabled` flags on long-lived instances would risk one request's config
 * leaking into another's.
 */
export async function runTracePipeline(imageData: ImageData, config: Partial<PipelineStageConfig> = {}): Promise<PipelineResult> {
  const resolvedConfig: PipelineStageConfig = { ...DEFAULT_PIPELINE_CONFIG, ...config }
  const originalDimensions = { width: imageData.width, height: imageData.height }
  const stageTimings: StageTiming[] = []

  const preprocessingStages: PreprocessingStageEntry[] = [
    { configKey: 'autoUpscale', stage: new AutoUpscaleStage() },
    { configKey: 'noiseReduction', stage: new NoiseReductionStage() },
    { configKey: 'backgroundCleanup', stage: new BackgroundCleanupStage() },
    { configKey: 'contrastNormalization', stage: new ContrastNormalizationStage() },
    { configKey: 'colorQuantization', stage: new ColorQuantizationStage() },
    { configKey: 'edgeEnhancement', stage: new EdgeEnhancementStage() },
  ]

  let current = imageData
  for (const { configKey, stage } of preprocessingStages) {
    const enabled = resolvedConfig[configKey]
    const start = performance.now()
    if (enabled) current = await stage.process(current)
    stageTimings.push({ name: stage.name, durationMs: performance.now() - start, enabled })
  }

  const selectionStage = new ProviderSelectionStage()
  const selectionStart = performance.now()
  const selectionResult = await selectionStage.process(current)
  stageTimings.push({ name: selectionStage.name, durationMs: performance.now() - selectionStart, enabled: true })

  const optimizationStage = new SvgOptimizationStage(originalDimensions)
  const optimizationStart = performance.now()
  const svg = await optimizationStage.process(selectionResult)
  stageTimings.push({ name: optimizationStage.name, durationMs: performance.now() - optimizationStart, enabled: true })

  return {
    svg,
    provider: selectionResult.provider,
    tracePreset: selectionResult.tracePreset,
    analysis: selectionResult.analysis,
    stageTimings,
    totalTimeMs: stageTimings.reduce((sum, timing) => sum + timing.durationMs, 0),
  }
}

/** Professional Trace: the full preprocessing pipeline. */
export function runProfessionalTrace(imageData: ImageData, config: Partial<PipelineStageConfig> = {}): Promise<PipelineResult> {
  return runTracePipeline(imageData, { ...DEFAULT_PIPELINE_CONFIG, ...config })
}

/** Quick Trace: bypasses every preprocessing stage — provider selection + SVG optimization only, on the original untouched pixels. */
export function runQuickTrace(imageData: ImageData): Promise<PipelineResult> {
  return runTracePipeline(imageData, QUICK_TRACE_CONFIG)
}
