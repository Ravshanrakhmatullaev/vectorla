import type { PipelineStage } from '../PipelineStage'

// Levels per channel — 6 gives a visibly flatter, cleaner source for
// tracing without crushing genuinely distinct colors into one bucket.
const DEFAULT_LEVELS = 6

/**
 * Real, working uniform color quantization — rounds each RGB channel to a
 * fixed number of levels. Deliberately simpler than ImageTracer's own
 * internal numberofcolors quantization (tracePresets.ts) or Potrace's
 * binary threshold: this runs *before* either provider sees the image, so
 * it flattens compression-artifact color noise regardless of which
 * provider ProviderSelectionStage ends up choosing.
 */
export class ColorQuantizationStage implements PipelineStage<ImageData, ImageData> {
  readonly name = 'color-quantization'

  constructor(private readonly levels: number = DEFAULT_LEVELS) {}

  process(input: ImageData): ImageData {
    const { width, height, data } = input
    const step = 255 / (this.levels - 1)
    const output = new Uint8ClampedArray(data)

    for (let i = 0; i < width * height; i++) {
      const idx = i * 4
      for (let channel = 0; channel < 3; channel++) {
        const value = data[idx + channel] ?? 0
        output[idx + channel] = Math.round(Math.round(value / step) * step)
      }
    }

    return { width, height, data: output }
  }
}
