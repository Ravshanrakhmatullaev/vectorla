import type { PipelineStage } from '../PipelineStage'

/**
 * Reserved hook for real upscaling (e.g. a real-ESRGAN-style model, or even
 * simple bicubic resampling) of low-resolution uploads before the rest of
 * the Professional Trace pipeline runs — Phase 25 explicitly leaves AI out
 * of scope, so this is a documented no-op, not a stub that throws. Disabled
 * by default in DEFAULT_PIPELINE_CONFIG (see ProfessionalTracePipeline.ts);
 * even if enabled, it currently just passes the image through unchanged.
 */
export class AutoUpscaleStage implements PipelineStage<ImageData, ImageData> {
  readonly name = 'auto-upscale'

  process(input: ImageData): ImageData {
    return input
  }
}
