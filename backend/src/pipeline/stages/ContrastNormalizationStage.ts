import type { PipelineStage } from '../PipelineStage'

function luma(r: number, g: number, b: number): number {
  return 0.299 * r + 0.587 * g + 0.114 * b
}

/**
 * Classic linear "auto-levels" contrast stretch: finds the darkest/lightest
 * luma in the image and linearly remaps the full range to 0-255, so a
 * washed-out/low-contrast scan traces with the same fidelity a
 * well-exposed one would. Real math, not a placeholder — a no-op only when
 * the image is already flat (min == max, nothing to stretch).
 */
export class ContrastNormalizationStage implements PipelineStage<ImageData, ImageData> {
  readonly name = 'contrast-normalization'

  process(input: ImageData): ImageData {
    const { width, height, data } = input
    let min = 255
    let max = 0

    for (let i = 0; i < width * height; i++) {
      const idx = i * 4
      const value = luma(data[idx] ?? 0, data[idx + 1] ?? 0, data[idx + 2] ?? 0)
      if (value < min) min = value
      if (value > max) max = value
    }

    const range = max - min
    if (range < 1) return input

    const output = new Uint8ClampedArray(data)
    for (let i = 0; i < width * height; i++) {
      const idx = i * 4
      for (let channel = 0; channel < 3; channel++) {
        const value = data[idx + channel] ?? 0
        output[idx + channel] = Math.round(((value - min) / range) * 255)
      }
    }

    return { width, height, data: output }
  }
}
