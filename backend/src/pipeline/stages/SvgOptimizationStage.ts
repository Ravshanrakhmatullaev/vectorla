import type { PipelineStage } from '../PipelineStage'
import { optimizeSvg } from '../../providers/svgOptimizer'
import type { ProviderSelectionResult } from './ProviderSelectionStage'

/**
 * Final pipeline stage — reuses the same svgOptimizer.ts every provider
 * already normalizes its own output through (strips degenerate paths,
 * sets one authoritative width/height/viewBox). Takes the *original*
 * pre-pipeline dimensions explicitly, not whatever size the (possibly
 * upscaled, once AutoUpscaleStage is real) working ImageData ended up at —
 * the exported SVG's declared size should always match what the caller
 * actually asked to vectorize.
 */
export class SvgOptimizationStage implements PipelineStage<ProviderSelectionResult, string> {
  readonly name = 'svg-optimization'

  constructor(private readonly outputDimensions: { width: number; height: number }) {}

  process(input: ProviderSelectionResult): string {
    return optimizeSvg(input.rawSvg, this.outputDimensions)
  }
}
