import type { PipelineStage } from '../PipelineStage'
import { boxBlur3x3 } from '../imageMath'

/**
 * Real, working denoising — a 3x3 box blur smooths sensor/compression noise
 * before the rest of the pipeline runs. Deliberately provider-agnostic and
 * independent of ImageTracer's own blurradius option (tracePresets.ts) or
 * Potrace's threshold: this runs once, up front, regardless of which
 * provider ProviderSelectionStage ends up choosing.
 */
export class NoiseReductionStage implements PipelineStage<ImageData, ImageData> {
  readonly name = 'noise-reduction'

  process(input: ImageData): ImageData {
    return boxBlur3x3(input)
  }
}
