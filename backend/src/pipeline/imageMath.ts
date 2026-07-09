/**
 * Shared pixel-math helpers for the preprocessing stages (Phase 25) — kept
 * separate from any one stage since more than one needs the same primitive
 * (box blur underlies both noise reduction and, inverted, edge enhancement).
 */

/** A simple 3x3 box blur (average of all 8 neighbors + self) — real, working denoising, not a stub. Alpha is blurred too (matches how a real camera/scan would blend a soft edge). */
export function boxBlur3x3(imageData: ImageData): ImageData {
  const { width, height, data } = imageData
  const output = new Uint8ClampedArray(data.length)

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      for (let channel = 0; channel < 4; channel++) {
        let sum = 0
        let count = 0
        for (let dy = -1; dy <= 1; dy++) {
          const ny = y + dy
          if (ny < 0 || ny >= height) continue
          for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx
            if (nx < 0 || nx >= width) continue
            sum += data[(ny * width + nx) * 4 + channel] ?? 0
            count++
          }
        }
        output[(y * width + x) * 4 + channel] = Math.round(sum / count)
      }
    }
  }

  return { width, height, data: output }
}

/** Average RGB of the outermost ring of pixels — a cheap, real estimate of "what counts as background" for BackgroundCleanupStage, without any ML/segmentation. */
export function estimateBorderColor(imageData: ImageData): { r: number; g: number; b: number } {
  const { width, height, data } = imageData
  let r = 0
  let g = 0
  let b = 0
  let count = 0

  function sample(x: number, y: number): void {
    const i = (y * width + x) * 4
    r += data[i] ?? 0
    g += data[i + 1] ?? 0
    b += data[i + 2] ?? 0
    count++
  }

  for (let x = 0; x < width; x++) {
    sample(x, 0)
    sample(x, height - 1)
  }
  for (let y = 0; y < height; y++) {
    sample(0, y)
    sample(width - 1, y)
  }

  if (count === 0) return { r: 255, g: 255, b: 255 }
  return { r: Math.round(r / count), g: Math.round(g / count), b: Math.round(b / count) }
}
