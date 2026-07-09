/**
 * The one interface every stage in the Professional Trace pipeline
 * implements (Phase 25) — deliberately generic so stages with genuinely
 * different input/output types (the 6 image-domain preprocessing stages are
 * ImageData -> ImageData; provider selection and SVG optimization aren't)
 * can all still satisfy the same contract, be timed identically by
 * ProfessionalTracePipeline.ts, and be tested in isolation ("independent
 * preprocessing stages" — task requirement 1).
 */
export interface PipelineStage<TInput, TOutput> {
  readonly name: string
  process(input: TInput): TOutput | Promise<TOutput>
}

/** One stage's measured contribution to a pipeline run — task requirement 6 ("measure processing time per stage"). */
export interface StageTiming {
  name: string
  durationMs: number
  enabled: boolean
}
