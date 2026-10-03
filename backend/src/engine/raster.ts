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

/**
 * Area-average (box) downsample to exactly `W`x`H`, alpha-weighted like upscaleBilinear.
 * Source rows map to output rows in order, so sums are kept for one output
 * row at a time: memory is O(W), not O(W·H) — this runs on the largest
 * images (up to MAX_IMAGE_PIXELS) where the full decoded buffer is already
 * most of a Worker's memory.
 */
export function downscaleArea(image: RgbaImage, W: number, H: number): RgbaImage {
  const { width: w, height: h, data: src } = image
  if (W >= w && H >= h) return image
  const out = new Uint8ClampedArray(W * H * 4)
  const sums = new Float64Array(W * 5)
  const xMap = new Int32Array(w)
  for (let x = 0; x < w; x++) xMap[x] = Math.min(W - 1, Math.floor((x * W) / w))
  const flush = (Y: number) => {
    for (let X = 0; X < W; X++) {
      const o = X * 5
      const aSum = sums[o + 3]!
      const count = sums[o + 4]! || 1
      const p = (Y * W + X) * 4
      if (aSum > 0) {
        out[p] = sums[o]! / aSum
        out[p + 1] = sums[o + 1]! / aSum
        out[p + 2] = sums[o + 2]! / aSum
      }
      out[p + 3] = aSum / count
    }
    sums.fill(0)
  }
  let currentY = 0
  for (let y = 0; y < h; y++) {
    const Y = Math.min(H - 1, Math.floor((y * H) / h))
    if (Y !== currentY) {
      flush(currentY)
      currentY = Y
    }
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      const a = src[i + 3] ?? 0
      const o = xMap[x]! * 5
      sums[o] = sums[o]! + (src[i] ?? 0) * a
      sums[o + 1] = sums[o + 1]! + (src[i + 1] ?? 0) * a
      sums[o + 2] = sums[o + 2]! + (src[i + 2] ?? 0) * a
      sums[o + 3] = sums[o + 3]! + a
      sums[o + 4] = sums[o + 4]! + 1
    }
  }
  flush(currentY)
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

  const spatialW = Float64Array.from(spatial)
  const size = 2 * radius + 1
  for (let y = 0; y < h; y++) {
    const yInside = y >= radius && y < h - radius
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      const r0 = src[i]!
      const g0 = src[i + 1]!
      const b0 = src[i + 2]!
      let sr = 0
      let sg = 0
      let sb = 0
      let sw = 0
      if (yInside && x >= radius && x < w - radius) {
        // Interior: no bounds checks. Same taps, same order, same arithmetic
        // as the edge path below, so the result is bit-identical.
        for (let dy = 0; dy < size; dy++) {
          let j = ((y + dy - radius) * w + (x - radius)) * 4
          const row = dy * size
          for (let dx = 0; dx < size; dx++, j += 4) {
            const r = src[j]!
            const g = src[j + 1]!
            const b = src[j + 2]!
            const dr = r - r0
            const dg = g - g0
            const db = b - b0
            const weight = spatialW[row + dx]! * rangeLut[dr * dr + dg * dg + db * db]! * (src[j + 3]! / 255)
            sr += r * weight
            sg += g * weight
            sb += b * weight
            sw += weight
          }
        }
      } else {
        let k = 0
        for (let dy = -radius; dy <= radius; dy++) {
          const ny = y + dy
          for (let dx = -radius; dx <= radius; dx++, k++) {
            const nx = x + dx
            if (ny < 0 || ny >= h || nx < 0 || nx >= w) continue
            const j = (ny * w + nx) * 4
            const r = src[j]!
            const g = src[j + 1]!
            const b = src[j + 2]!
            const dr = r - r0
            const dg = g - g0
            const db = b - b0
            const weight = spatialW[k]! * rangeLut[dr * dr + dg * dg + db * db]! * (src[j + 3]! / 255)
            sr += r * weight
            sg += g * weight
            sb += b * weight
            sw += weight
          }
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
      out[i + 3] = src[i + 3]!
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

/**
 * JPEG chroma restoration (joint bilateral filter guided by luma).
 *
 * JPEG stores color (Cb/Cr) at half resolution in 8x8/16x16 blocks while
 * keeping luma sharp. Around a color edge the decoded pixels therefore carry
 * luma from one side but averaged chroma — colors that belong to neither
 * shape (the gray fringe between yellow and blue) — and the chroma edge
 * follows the block grid in 8-16 px steps. Re-estimating each pixel's chroma
 * from neighbours with similar luma snaps color transitions back onto the
 * sharp luma edge. Luma itself is left untouched.
 */
export function restoreJpegChroma(image: RgbaImage, radius = 4, lumaSigma = 12): RgbaImage {
  const { width: w, height: h, data } = image
  const n = w * h
  const Y = new Float32Array(n)
  const Cb = new Float32Array(n)
  const Cr = new Float32Array(n)
  for (let p = 0; p < n; p++) {
    const r = data[p * 4] ?? 0
    const g = data[p * 4 + 1] ?? 0
    const b = data[p * 4 + 2] ?? 0
    Y[p] = 0.299 * r + 0.587 * g + 0.114 * b
    Cb[p] = -0.168736 * r - 0.331264 * g + 0.5 * b
    Cr[p] = 0.5 * r - 0.418688 * g - 0.081312 * b
  }
  const spatialSigma = Math.max(1, radius / 2)
  const spatial: number[] = []
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) spatial.push(Math.exp(-(dx * dx + dy * dy) / (2 * spatialSigma * spatialSigma)))
  }
  const rangeLut = new Float32Array(256)
  for (let d = 0; d < 256; d++) rangeLut[d] = Math.exp(-(d * d) / (2 * lumaSigma * lumaSigma))

  const out = new Uint8ClampedArray(data.length)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = y * w + x
      const y0 = Y[p]!
      let sw = 0
      let scb = 0
      let scr = 0
      let k = 0
      for (let dy = -radius; dy <= radius; dy++) {
        const ny = y + dy
        for (let dx = -radius; dx <= radius; dx++, k++) {
          const nx = x + dx
          if (ny < 0 || ny >= h || nx < 0 || nx >= w) continue
          const q = ny * w + nx
          if ((data[q * 4 + 3] ?? 0) === 0) continue
          const weight = spatial[k]! * rangeLut[Math.min(255, Math.round(Math.abs(Y[q]! - y0)))]!
          sw += weight
          scb += Cb[q]! * weight
          scr += Cr[q]! * weight
        }
      }
      const cb = sw > 0 ? scb / sw : Cb[p]!
      const cr = sw > 0 ? scr / sw : Cr[p]!
      out[p * 4] = y0 + 1.402 * cr
      out[p * 4 + 1] = y0 - 0.344136 * cb - 0.714136 * cr
      out[p * 4 + 2] = y0 + 1.772 * cb
      out[p * 4 + 3] = data[p * 4 + 3] ?? 255
    }
  }
  return { width: w, height: h, data: out }
}
