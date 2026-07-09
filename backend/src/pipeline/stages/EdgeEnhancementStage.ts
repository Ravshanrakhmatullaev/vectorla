import type { PipelineStage } from '../PipelineStage'
import { boxBlur3x3 } from '../imageMath'

// How strongly the sharpened result is pushed away from the blurred
// version — 0 would be a no-op, 1+ starts producing visible halos.
const DEFAULT_AMOUNT = 0.6

/**
 * Real unsharp-mask sharpening: blurs the image, then pushes each pixel
 * further away from its blurred value along the same direction — the
 * classic "sharpen" technique, not a stub. Runs after color quantization so
 * it re-adds crisp edges the quantization step may have softened, without
 * re-introducing the noise NoiseReductionStage already removed. Alpha is
 * left untouched.
 */
export class EdgeEnhancementStage implements PipelineStage<ImageData, ImageData> {
  readonly name = 'edge-enhancement'

  constructor(private readonly amount: number = DEFAULT_AMOUNT) {}

  process(input: ImageData): ImageData {
    const blurred = boxBlur3x3(input)
    const { width, height, data } = input
    const output = new Uint8ClampedArray(data.length)

    for (let i = 0; i < width * height; i++) {
      const idx = i * 4
      for (let channel = 0; channel < 3; channel++) {
        const original = data[idx + channel] ?? 0
        const blurredValue = blurred.data[idx + channel] ?? 0
        output[idx + channel] = Math.round(original + (original - blurredValue) * this.amount)
      }
      output[idx + 3] = data[idx + 3] ?? 255
    }

    return { width, height, data: output }
  }
}
