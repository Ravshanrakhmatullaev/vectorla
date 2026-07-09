import type { PipelineStage } from '../PipelineStage'
import { estimateBorderColor } from '../imageMath'

// Pixels within this Euclidean RGB distance of the estimated background
// color get snapped flat to it — cleans up compression artifacts/faint
// scan noise around the true subject without a real segmentation model.
const BACKGROUND_COLOR_DISTANCE_THRESHOLD = 24

/**
 * Estimates the background color from the image's outer border (a real,
 * simple heuristic — not ML-based segmentation) and flattens any pixel
 * close to it, so faint anti-aliasing halos/scan noise around the true
 * subject don't get traced as extra noisy paths. Alpha is left untouched —
 * this only cleans up color, never invents or removes transparency.
 */
export class BackgroundCleanupStage implements PipelineStage<ImageData, ImageData> {
  readonly name = 'background-cleanup'

  process(input: ImageData): ImageData {
    const { width, height, data } = input
    const background = estimateBorderColor(input)
    const output = new Uint8ClampedArray(data)

    for (let i = 0; i < width * height; i++) {
      const idx = i * 4
      const dr = (data[idx] ?? 0) - background.r
      const dg = (data[idx + 1] ?? 0) - background.g
      const db = (data[idx + 2] ?? 0) - background.b
      const distance = Math.sqrt(dr * dr + dg * dg + db * db)
      if (distance <= BACKGROUND_COLOR_DISTANCE_THRESHOLD) {
        output[idx] = background.r
        output[idx + 1] = background.g
        output[idx + 2] = background.b
      }
    }

    return { width, height, data: output }
  }
}
