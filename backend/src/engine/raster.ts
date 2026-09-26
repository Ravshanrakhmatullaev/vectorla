/**
 * Raster resampling helpers for the tracing engine.
 *
 * Professional tracers never fit curves to the raw pixel staircase of a small
 * image: anti-aliased edge pixels carry sub-pixel information about where the
 * true edge lies. Upsampling with interpolation before segmentation turns that
 * coverage information into geometry (the 50% contour of an AA edge lands at
 * its true sub-pixel position), which is why tiny logos and icons trace far
 * more accurately after this step. Large images go the other way: they're
 * area-averaged down to a bounded working size so the Worker stays within its
 * CPU and memory budget.
 */

export interface RgbaImage {
  width: number
  height: number
  data: Uint8ClampedArray
}

/**
 * Bilinear upsample by an integer factor. Color channels are interpolated with
 * alpha weighting (premultiplied), so fully transparent pixels — whose RGB is
 * often garbage such as black — never bleed dark fringes into opaque edges.
 */
export function upscaleBilinear(image: RgbaImage, factor: number): RgbaImage {
  if (factor <= 1) return image
  const { width: w, height: h, data: src } = image
  const W = w * factor
  const H = h * factor
  const out = new Uint8ClampedArray(W * H * 4)

  for (let Y = 0; Y < H; Y++) {
    // Sample at output pixel centers mapped back into source pixel-center space.
    const sy = (Y + 0.5) / factor - 0.5
    const y0 = Math.max(0, Math.min(h - 1, Math.floor(sy)))
    const y1 = Math.min(h - 1, y0 + 1)
    const fy = Math.max(0, Math.min(1, sy - y0))
    for (let X = 0; X < W; X++) {
      const sx = (X + 0.5) / factor - 0.5
      const x0 = Math.max(0, Math.min(w - 1, Math.floor(sx)))
      const x1 = Math.min(w - 1, x0 + 1)
      const fx = Math.max(0, Math.min(1, sx - x0))

      const i00 = (y0 * w + x0) * 4
      const i10 = (y0 * w + x1) * 4
      const i01 = (y1 * w + x0) * 4
      const i11 = (y1 * w + x1) * 4
      const w00 = (1 - fx) * (1 - fy)
      const w10 = fx * (1 - fy)
      const w01 = (1 - fx) * fy
      const w11 = fx * fy

      const a00 = (src[i00 + 3] ?? 0) * w00
      const a10 = (src[i10 + 3] ?? 0) * w10
      const a01 = (src[i01 + 3] ?? 0) * w01
      const a11 = (src[i11 + 3] ?? 0) * w11
      const alpha = a00 + a10 + a01 + a11
      const o = (Y * W + X) * 4
      if (alpha > 0) {
        for (let c = 0; c < 3; c++) {
          out[o + c] =
            ((src[i00 + c] ?? 0) * a00 + (src[i10 + c] ?? 0) * a10 + (src[i01 + c] ?? 0) * a01 + (src[i11 + c] ?? 0) * a11) / alpha
        }
      }
      out[o + 3] = alpha
    }
  }

  return { width: W, height: H, data: out }
}

/** Area-average (box) downsample to exactly `W`x`H`, alpha-weighted like upscaleBilinear. */
export function downscaleArea(image: RgbaImage, W: number, H: number): RgbaImage {
  const { width: w, height: h, data: src } = image
  if (W >= w && H >= h) return image
  const sums = new Float64Array(W * H * 5)
  for (let y = 0; y < h; y++) {
    const Y = Math.min(H - 1, Math.floor((y * H) / h))
    for (let x = 0; x < w; x++) {
      const X = Math.min(W - 1, Math.floor((x * W) / w))
      const i = (y * w + x) * 4
      const a = src[i + 3] ?? 0
      const o = (Y * W + X) * 5
      sums[o] = (sums[o] ?? 0) + (src[i] ?? 0) * a
      sums[o + 1] = (sums[o + 1] ?? 0) + (src[i + 1] ?? 0) * a
      sums[o + 2] = (sums[o + 2] ?? 0) + (src[i + 2] ?? 0) * a
      sums[o + 3] = (sums[o + 3] ?? 0) + a
      sums[o + 4] = (sums[o + 4] ?? 0) + 1
    }
  }
  const out = new Uint8ClampedArray(W * H * 4)
  for (let p = 0; p < W * H; p++) {
    const o = p * 5
    const aSum = sums[o + 3] ?? 0
    const count = sums[o + 4] ?? 1
    if (aSum > 0) {
      out[p * 4] = (sums[o] ?? 0) / aSum
      out[p * 4 + 1] = (sums[o + 1] ?? 0) / aSum
      out[p * 4 + 2] = (sums[o + 2] ?? 0) / aSum
    }
    out[p * 4 + 3] = aSum / count
  }
  return { width: W, height: H, data: out }
}

/**
 * Edge-preserving denoise: a small bilateral filter in RGB space. Unlike the
 * old pipeline's box blur, it smooths JPEG block noise and sensor grain inside
 * flat regions while leaving real color edges sharp, so the palette and the
 * traced boundaries don't inherit either the noise or a blurred edge.
 */
export function bilateralDenoise(image: RgbaImage, radius: number, rangeSigma: number): RgbaImage {
  if (radius <= 0) return image
  const { width: w, height: h, data: src } = image
  const out = new Uint8ClampedArray(src.length)
  const spatialSigma = Math.max(1, radius / 1.5)
  const spatial: number[] = []
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      spatial.push(Math.exp(-(dx * dx + dy * dy) / (2 * spatialSigma * spatialSigma)))
    }
  }
  const rangeDenom = 2 * rangeSigma * rangeSigma
  const rangeLut = new Float32Array(3 * 255 * 255 + 1)
  for (let d = 0; d < rangeLut.length; d++) rangeLut[d] = Math.exp(-d / rangeDenom)

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      const r0 = src[i] ?? 0
      const g0 = src[i + 1] ?? 0
      const b0 = src[i + 2] ?? 0
      let sr = 0
      let sg = 0
      let sb = 0
      let sw = 0
      let k = 0
      for (let dy = -radius; dy <= radius; dy++) {
        const ny = y + dy
        for (let dx = -radius; dx <= radius; dx++, k++) {
          const nx = x + dx
          if (ny < 0 || ny >= h || nx < 0 || nx >= w) continue
          const j = (ny * w + nx) * 4
          const r = src[j] ?? 0
          const g = src[j + 1] ?? 0
          const b = src[j + 2] ?? 0
          const dr = r - r0
          const dg = g - g0
          const db = b - b0
          const weight = (spatial[k] ?? 0) * (rangeLut[dr * dr + dg * dg + db * db] ?? 0) * ((src[j + 3] ?? 0) / 255)
          sr += r * weight
          sg += g * weight
          sb += b * weight
          sw += weight
        }
      }
      if (sw > 0) {
        out[i] = sr / sw
        out[i + 1] = sg / sw
        out[i + 2] = sb / sw
      } else {
        out[i] = r0
        out[i + 1] = g0
        out[i + 2] = b0
      }
      out[i + 3] = src[i + 3] ?? 0
    }
  }
  return { width: w, height: h, data: out }
}

/**
 * Separable Gaussian blur (alpha-weighted color, alpha blurred too). Used after
 * bilinear upsampling: bilinear interpolation leaves a faint scalloped ripple
 * with the period of the source pixel grid along diagonal edges, and a blur of
 * about half a source pixel removes it without moving straight edges (a
 * symmetric blur keeps an edge's 50% contour in place).
 */
export function gaussianBlur(image: RgbaImage, sigma: number): RgbaImage {
  if (sigma <= 0) return image
  const { width: w, height: h, data } = image
  const radius = Math.max(1, Math.ceil(sigma * 2.5))
  const kernel = new Float32Array(radius * 2 + 1)
  let ksum = 0
  for (let i = -radius; i <= radius; i++) {
    const v = Math.exp(-(i * i) / (2 * sigma * sigma))
    kernel[i + radius] = v
    ksum += v
  }
  for (let i = 0; i < kernel.length; i++) kernel[i] = kernel[i]! / ksum

  // One channel at a time through two reusable float planes (~12 bytes per
  // pixel in total) — a full float RGBA copy would cost 32 bytes per pixel,
  // too much for a 128 MB Worker at multi-megapixel working sizes.
  const n = w * h
  const planeA = new Float32Array(n)
  const planeB = new Float32Array(n)
  const alpha = new Float32Array(n)
  const out = new Uint8ClampedArray(n * 4)

  const blurPlane = (src: Float32Array, tmp: Float32Array) => {
    for (let y = 0; y < h; y++) {
      const row = y * w
      for (let x = 0; x < w; x++) {
        let acc = 0
        for (let k = -radius; k <= radius; k++) {
          const xx = x + k < 0 ? 0 : x + k >= w ? w - 1 : x + k
          acc += src[row + xx]! * kernel[k + radius]!
        }
        tmp[row + x] = acc
      }
    }
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let acc = 0
        for (let k = -radius; k <= radius; k++) {
          const yy = y + k < 0 ? 0 : y + k >= h ? h - 1 : y + k
          acc += tmp[yy * w + x]! * kernel[k + radius]!
        }
        src[y * w + x] = acc
      }
    }
  }

  // Blurred alpha first; the original alpha is read straight from `data`.
  for (let p = 0; p < n; p++) alpha[p] = (data[p * 4 + 3] ?? 0) / 255
  blurPlane(alpha, planeB)
  for (let p = 0; p < n; p++) out[p * 4 + 3] = alpha[p]! * 255
  // Premultiplied color channels, so transparent pixels don't bleed color.
  for (let c = 0; c < 3; c++) {
    for (let p = 0; p < n; p++) planeA[p] = ((data[p * 4 + c] ?? 0) * (data[p * 4 + 3] ?? 0)) / 255
    blurPlane(planeA, planeB)
    for (let p = 0; p < n; p++) {
      const a = alpha[p]!
      out[p * 4 + c] = a > 1e-6 ? planeA[p]! / a : 0
    }
  }
  return { width: w, height: h, data: out }
}

/**
 * Maps a source-resolution mask onto an integer-upscaled grid: a working pixel
 * is set only if every source pixel that bilinear interpolation blended into
 * it is set (so interpolated blends between two flat regions never count).
 */
export function upscaleMaskStrict(mask: Uint8Array, width: number, height: number, factor: number): Uint8Array {
  if (factor <= 1) return mask
  const W = width * factor
  const H = height * factor
  const out = new Uint8Array(W * H)
  for (let Y = 0; Y < H; Y++) {
    const sy = (Y + 0.5) / factor - 0.5
    const y0 = Math.max(0, Math.min(height - 1, Math.floor(sy)))
    const y1 = Math.min(height - 1, y0 + 1)
    for (let X = 0; X < W; X++) {
      const sx = (X + 0.5) / factor - 0.5
      const x0 = Math.max(0, Math.min(width - 1, Math.floor(sx)))
      const x1 = Math.min(width - 1, x0 + 1)
      if (mask[y0 * width + x0] && mask[y0 * width + x1] && mask[y1 * width + x0] && mask[y1 * width + x1]) out[Y * W + X] = 1
    }
  }
  return out
}
