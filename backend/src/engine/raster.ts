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
import { checkpoint } from './memoryCheckpoint'

export interface RgbaImage {
  width: number
  height: number
  data: Uint8ClampedArray
  /** Source pixels per pixel when produced by downscaleBox (exact integer factor). */
  scale?: number
}

/**
 * Marks isolated hairline pixels: pixels darker or lighter than both
 * neighbours along some direction by at least `threshold` in some channel,
 * where the two neighbours match each other (a one-pixel line on a single
 * background, not an edge between two fills). A diagonal ridge also needs at
 * most one axis neighbour of its own colour, which rejects checkerboard
 * corners (two blocks touching diagonally) that look like a diagonal line in
 * a 3x3 window, and no far stronger neighbour along the line (block
 * corners). Speckles (runs of one or two pixels, or short runs containing a
 * lone dot) are dropped. The mask is dilated by two pixels: it covers the
 * bicubic support and bridges the short breaks where a shallow line crosses
 * between pixel rows (split coverage, so no single pixel is a ridge there).
 */
export function ridgeMask(image: RgbaImage, threshold: number): Uint8Array {
  const { width: w, height: h, data } = image
  const raw = new Uint8Array(w * h)
  const dirs = [1, 0, 0, 1, 1, 1, 1, -1]
  const at = (x: number, y: number, c: number) => (x < 0 || y < 0 || x >= w || y >= h ? -1 : data[(y * w + x) * 4 + c]!)
  const similar = (x0: number, y0: number, x1: number, y1: number) => {
    for (let k = 0; k < 4; k++) {
      const d = at(x0, y0, k) - at(x1, y1, k)
      if (d * 2 >= threshold || d * 2 <= -threshold) return false
    }
    return true
  }
  const axisTwins = (x: number, y: number) =>
    (x > 0 && similar(x, y, x - 1, y) ? 1 : 0) +
    (x < w - 1 && similar(x, y, x + 1, y) ? 1 : 0) +
    (y > 0 && similar(x, y, x, y - 1) ? 1 : 0) +
    (y < h - 1 && similar(x, y, x, y + 1) ? 1 : 0)
  // An anti-aliased corner of a solid block reads as a faint diagonal ridge,
  // but one of its neighbours along that diagonal is the block itself, far
  // stronger than the corner pixel; along a real line the contrast stays similar.
  const strongerAlong = (x: number, y: number, dx: number, dy: number, c: number) => {
    const side = at(x - dx, y - dy, c)
    const contrast = Math.abs(at(x, y, c) - side)
    for (const s of [-1, 1]) {
      const v = at(x + s * dx, y - s * dy, c)
      if (v >= 0 && Math.abs(v - side) > contrast + threshold) return true
    }
    return false
  }
  // raw: 1 = ridge pixel, 2 = ridge pixel that is also a lone dot (darker or
  // lighter than its neighbours in all four directions).
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let ridge = false
      let extrema = 0
      for (let d = 0; d < 8; d += 2) {
        const dx = dirs[d]!
        const dy = dirs[d + 1]!
        if (x - dx < 0 || x + dx >= w || y - dy < 0 || y - dy >= h || y + dy < 0 || y + dy >= h) continue
        for (let c = 0; c < 4; c++) {
          const v = at(x, y, c)
          const da = v - at(x - dx, y - dy, c)
          const db = v - at(x + dx, y + dy, c)
          if (da >= threshold ? db >= threshold : da <= -threshold && db <= -threshold) {
            extrema++
            ridge ||= similar(x - dx, y - dy, x + dx, y + dy) && (dx === 0 || dy === 0 || (axisTwins(x, y) <= 1 && !strongerAlong(x, y, dx, dy, c)))
            break
          }
        }
      }
      if (ridge) raw[y * w + x] = extrema === 4 ? 2 : 1
    }
  }
  // A hairline is a run of ridge pixels, broken for a pixel or two where it
  // crosses between pixel rows; noise is lone dots and pairs. Runs are linked
  // across one-pixel gaps (5x5). A run of one or two pixels is dropped, and so
  // is any run shorter than MIN_RIDGE_RUN that contains a lone dot.
  const MIN_RIDGE_RUN = 4
  const stack = new Int32Array(w * h)
  const run: number[] = []
  for (let start = 0; start < w * h; start++) {
    if (raw[start] !== 1 && raw[start] !== 2) continue
    let dot = raw[start] === 2
    raw[start] = 3
    stack[0] = start
    let top = 1
    run.length = 0
    while (top > 0) {
      const p = stack[--top]!
      run.push(p)
      const px = p % w
      const py = (p - px) / w
      for (let j = Math.max(0, py - 2); j <= Math.min(h - 1, py + 2); j++)
        for (let i = Math.max(0, px - 2); i <= Math.min(w - 1, px + 2); i++) {
          const q = j * w + i
          if (raw[q] === 1 || raw[q] === 2) {
            if (raw[q] === 2) dot = true
            raw[q] = 3
            stack[top++] = q
          }
        }
    }
    if (run.length < 3 || (dot && run.length < MIN_RIDGE_RUN)) for (const p of run) raw[p] = 0
  }
  const RIDGE_DILATION = 2
  const mask = new Uint8Array(w * h)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!raw[y * w + x]) continue
      for (let j = Math.max(0, y - RIDGE_DILATION); j <= Math.min(h - 1, y + RIDGE_DILATION); j++)
        for (let i = Math.max(0, x - RIDGE_DILATION); i <= Math.min(w - 1, x + RIDGE_DILATION); i++) mask[j * w + i] = 1
    }
  }
  return mask
}

/**
 * Overwrites the blurred upscale with sharp Catmull-Rom samples wherever the
 * source pixel is on a (dilated) ridge, so hairlines keep their contrast while
 * ordinary edges keep the smoothing blur (fewer, cleaner segments).
 */
export function restoreRidges(target: RgbaImage, source: RgbaImage, factor: number, mask: Uint8Array): void {
  const { width: w, height: h, data: src } = source
  const W = target.width
  const out = target.data
  const weights = new Float64Array(factor * 4)
  const offsets = new Int32Array(factor)
  for (let i = 0; i < factor; i++) {
    const s = (i + 0.5) / factor - 0.5
    const base = Math.floor(s)
    const t = s - base
    offsets[i] = base
    const t2 = t * t
    const t3 = t2 * t
    weights[i * 4] = (-t3 + 2 * t2 - t) / 2
    weights[i * 4 + 1] = (3 * t3 - 5 * t2 + 2) / 2
    weights[i * 4 + 2] = (-3 * t3 + 4 * t2 + t) / 2
    weights[i * 4 + 3] = (t3 - t2) / 2
  }
  const clampX = (x: number) => (x < 0 ? 0 : x >= w ? w - 1 : x)
  const clampY = (y: number) => (y < 0 ? 0 : y >= h ? h - 1 : y)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!mask[y * w + x]) continue
      for (let py = 0; py < factor; py++) {
        const Y = y * factor + py
        const by = y + offsets[py]!
        for (let px = 0; px < factor; px++) {
          const X = x * factor + px
          const bx = x + offsets[px]!
          let r = 0
          let g = 0
          let b = 0
          let alpha = 0
          for (let j = 0; j < 4; j++) {
            const wy = weights[py * 4 + j]!
            const row = clampY(by - 1 + j) * w
            for (let i = 0; i < 4; i++) {
              const q = (row + clampX(bx - 1 + i)) * 4
              const a = src[q + 3]! * wy * weights[px * 4 + i]!
              r += src[q]! * a
              g += src[q + 1]! * a
              b += src[q + 2]! * a
              alpha += a
            }
          }
          const o = (Y * W + X) * 4
          if (alpha > 0) {
            out[o] = r / alpha
            out[o + 1] = g / alpha
            out[o + 2] = b / alpha
          }
          out[o + 3] = alpha
        }
      }
    }
  }
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
 * Integer-factor box downscale: each output pixel is the alpha-weighted mean
 * of an exact k×k block (the last row/column of blocks may be partial; the
 * output is ceil(w/k) × ceil(h/k) and maps back at exactly k source pixels per
 * pixel). Unlike a fractional resample, every block has the same shape, so an
 * anti-aliased edge stays one clean blend pixel wide instead of being
 * smeared unevenly across bins of 1 and 2 pixels.
 */
export function downscaleBox(image: RgbaImage, k: number): RgbaImage {
  const { width: w, height: h, data: src } = image
  if (k <= 1) return image
  const W = Math.ceil(w / k)
  const H = Math.ceil(h / k)
  const out = new Uint8ClampedArray(W * H * 4)
  const sums = new Float64Array(W * 5)
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
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      const a = src[i + 3] ?? 0
      const o = Math.floor(x / k) * 5
      sums[o] = sums[o]! + (src[i] ?? 0) * a
      sums[o + 1] = sums[o + 1]! + (src[i + 1] ?? 0) * a
      sums[o + 2] = sums[o + 2]! + (src[i + 2] ?? 0) * a
      sums[o + 3] = sums[o + 3]! + a
      sums[o + 4] = sums[o + 4]! + 1
    }
    if ((y + 1) % k === 0 || y === h - 1) flush(Math.floor(y / k))
  }
  return { width: W, height: H, data: out, scale: k }
}

/**
 * Edge-preserving denoise: a small bilateral filter in RGB space. Unlike the
 * old pipeline's box blur, it smooths JPEG block noise and sensor grain inside
 * flat regions while leaving real color edges sharp, so the palette and the
 * traced boundaries don't inherit either the noise or a blurred edge.
 */
export function bilateralDenoise(image: RgbaImage, radius: number, rangeSigma: number, target?: Uint8ClampedArray): RgbaImage {
  if (radius <= 0) return image
  const { width: w, height: h, data: src } = image
  // `target`: a retired buffer of the same size to reuse (never the source).
  const out = target && target.length === src.length && target !== src ? target : new Uint8ClampedArray(src.length)
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
  checkpoint('bilateralDenoise')
  return { width: w, height: h, data: out }
}

/**
 * Separable Gaussian blur (alpha-weighted color, alpha blurred too). Used after
 * bilinear upsampling: bilinear interpolation leaves a faint scalloped ripple
 * with the period of the source pixel grid along diagonal edges, and a blur of
 * about half a source pixel removes it without moving straight edges (a
 * symmetric blur keeps an edge's 50% contour in place).
 */
export function gaussianBlur(image: RgbaImage, sigma: number, target?: Uint8ClampedArray): RgbaImage {
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

  // Rolling rows instead of whole-image float planes: each source row is
  // blurred horizontally once into a ring of 2·radius+1 rows per channel, and
  // the vertical pass reads that ring. Memory is O(width·radius) instead of
  // 12 bytes per pixel (48 MB at 4 MP). The arithmetic (float32 storage points
  // and summation order) matches a two-pass full-plane blur exactly.
  const n = w * h
  const out = target && target.length === n * 4 && target !== data ? target : new Uint8ClampedArray(n * 4)
  const size = 2 * radius + 1
  // ring[c] holds horizontally blurred rows for channel c (0-2 premultiplied
  // color, 3 alpha); slot = row % size.
  const ring = [0, 1, 2, 3].map(() => new Float32Array(size * w))
  const rowSrc = new Float32Array(w)
  let ready = -1
  const blurRow = (y: number) => {
    const slot = (y % size) * w
    const row = y * w
    for (let c = 0; c < 4; c++) {
      // Channel values exactly as stored in a float32 plane.
      if (c === 3) for (let x = 0; x < w; x++) rowSrc[x] = (data[(row + x) * 4 + 3] ?? 0) / 255
      else for (let x = 0; x < w; x++) rowSrc[x] = ((data[(row + x) * 4 + c] ?? 0) * (data[(row + x) * 4 + 3] ?? 0)) / 255
      const dst = ring[c]!
      for (let x = 0; x < w; x++) {
        let acc = 0
        for (let k = -radius; k <= radius; k++) {
          const xx = x + k < 0 ? 0 : x + k >= w ? w - 1 : x + k
          acc += rowSrc[xx]! * kernel[k + radius]!
        }
        dst[slot + x] = acc
      }
    }
  }
  const rowOffset = new Int32Array(size)
  const blurredAlpha = new Float32Array(w)
  const blurredColor = new Float32Array(w)
  const [ring0, ring1, ring2, ring3] = ring as [Float32Array, Float32Array, Float32Array, Float32Array]
  const verticalInto = (src: Float32Array, dst: Float32Array) => {
    for (let x = 0; x < w; x++) {
      let acc = 0
      for (let k = 0; k < size; k++) acc += src[rowOffset[k]! + x]! * kernel[k]!
      dst[x] = acc
    }
  }
  for (let y = 0; y < h; y++) {
    while (ready < Math.min(h - 1, y + radius)) blurRow(++ready)
    for (let k = -radius; k <= radius; k++) {
      const yy = y + k < 0 ? 0 : y + k >= h ? h - 1 : y + k
      rowOffset[k + radius] = (yy % size) * w
    }
    const row = y * w
    verticalInto(ring3, blurredAlpha)
    for (let x = 0; x < w; x++) out[(row + x) * 4 + 3] = blurredAlpha[x]! * 255
    for (let c = 0; c < 3; c++) {
      verticalInto(c === 0 ? ring0 : c === 1 ? ring1 : ring2, blurredColor)
      for (let x = 0; x < w; x++) {
        const a = blurredAlpha[x]!
        out[(row + x) * 4 + c] = a > 1e-6 ? blurredColor[x]! / a : 0
      }
    }
  }
  checkpoint('gaussianBlur')
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
export function restoreJpegChroma(image: RgbaImage, radius = 4, lumaSigma = 12, target?: Uint8ClampedArray): RgbaImage {
  const { width: w, height: h, data } = image
  // Luma/chroma for a rolling window of 2·radius+1 rows (float32, as full
  // planes would store them) instead of three whole-image planes: 12 bytes per
  // pixel would be 48 MB at 4 MP.
  const size = 2 * radius + 1
  const Y = new Float32Array(size * w)
  const Cb = new Float32Array(size * w)
  const Cr = new Float32Array(size * w)
  let ready = -1
  const convertRow = (row: number) => {
    const slot = (row % size) * w
    for (let x = 0; x < w; x++) {
      const p = row * w + x
      const r = data[p * 4] ?? 0
      const g = data[p * 4 + 1] ?? 0
      const b = data[p * 4 + 2] ?? 0
      Y[slot + x] = 0.299 * r + 0.587 * g + 0.114 * b
      Cb[slot + x] = -0.168736 * r - 0.331264 * g + 0.5 * b
      Cr[slot + x] = 0.5 * r - 0.418688 * g - 0.081312 * b
    }
  }
  const spatialSigma = Math.max(1, radius / 2)
  const spatial: number[] = []
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) spatial.push(Math.exp(-(dx * dx + dy * dy) / (2 * spatialSigma * spatialSigma)))
  }
  const rangeLut = new Float32Array(256)
  for (let d = 0; d < 256; d++) rangeLut[d] = Math.exp(-(d * d) / (2 * lumaSigma * lumaSigma))

  const out = target && target.length === data.length && target !== data ? target : new Uint8ClampedArray(data.length)
  for (let y = 0; y < h; y++) {
    while (ready < Math.min(h - 1, y + radius)) convertRow(++ready)
    const rowSlot = (y % size) * w
    for (let x = 0; x < w; x++) {
      const p = y * w + x
      const y0 = Y[rowSlot + x]!
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
          const qs = (ny % size) * w + nx
          const weight = spatial[k]! * rangeLut[Math.min(255, Math.round(Math.abs(Y[qs]! - y0)))]!
          sw += weight
          scb += Cb[qs]! * weight
          scr += Cr[qs]! * weight
        }
      }
      const cb = sw > 0 ? scb / sw : Cb[rowSlot + x]!
      const cr = sw > 0 ? scr / sw : Cr[rowSlot + x]!
      out[p * 4] = y0 + 1.402 * cr
      out[p * 4 + 1] = y0 - 0.344136 * cb - 0.714136 * cr
      out[p * 4 + 2] = y0 + 1.772 * cb
      out[p * 4 + 3] = data[p * 4 + 3] ?? 255
    }
  }
  checkpoint('restoreJpegChroma')
  return { width: w, height: h, data: out }
}
