// Synthetic stand-ins for real-world upload categories (Phase 23 quality
// testing). No real user images are available in this environment, so each
// generator procedurally builds pixels with the defining visual traits of its
// category (flat vs. gradient color, hard vs. soft edges, transparency,
// resolution) — the same ImageData shape jSquash's decoders hand the real
// PlaceholderProvider, so the full encode/decode/analyze/trace pipeline runs
// exactly as it would on a real upload. Deterministic (seeded PRNG) so runs
// are reproducible for before/after preset comparisons.

export type QualityTestMimeType = 'image/png' | 'image/jpeg'

export interface QualityTestImage {
  id: string
  label: string
  category: string
  mimeType: QualityTestMimeType
  imageData: ImageData
}

// mulberry32 — small, deterministic, no dependency.
function makeRng(seed: number): () => number {
  let a = seed
  return function random() {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function makeImageData(width: number, height: number, fill: (x: number, y: number) => [number, number, number, number]): ImageData {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4
      const [r, g, b, a] = fill(x, y)
      data[i] = r
      data[i + 1] = g
      data[i + 2] = b
      data[i + 3] = a
    }
  }
  return { width, height, data } as ImageData
}

function inCircle(x: number, y: number, cx: number, cy: number, r: number): boolean {
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r
}

// 1. Simple logo — one flat brand color, one hard-edged rounded shape, no transparency.
function simpleLogo(): ImageData {
  const size = 128
  return makeImageData(size, size, (x, y) => {
    const shape = inCircle(x, y, size / 2, size / 2, size * 0.34)
    return shape ? [40, 60, 220, 255] : [255, 255, 255, 255]
  })
}

// 2. Monochrome logo — single ink color glyph (blocky "V") on white.
function monochromeLogo(): ImageData {
  const size = 128
  return makeImageData(size, size, (x, y) => {
    const nx = x / size
    const ny = y / size
    // Two diagonal bars forming a V, thickness ~0.12
    const left = Math.abs(nx * 0.5 - ny * 0.5 + 0.15) < 0.08 && ny > 0.15 && ny < 0.85
    const right = Math.abs((1 - nx) * 0.5 - ny * 0.5 + 0.15) < 0.08 && ny > 0.15 && ny < 0.85
    return left || right ? [15, 15, 15, 255] : [255, 255, 255, 255]
  })
}

// 3. Colorful logo — six flat-color pie wedges, sharp radial edges.
function colorfulLogo(): ImageData {
  const size = 160
  const colors: [number, number, number][] = [
    [230, 60, 60],
    [240, 160, 30],
    [230, 220, 40],
    [50, 180, 90],
    [40, 110, 220],
    [140, 60, 200],
  ]
  return makeImageData(size, size, (x, y) => {
    const cx = size / 2
    const cy = size / 2
    const dx = x - cx
    const dy = y - cy
    const dist = Math.sqrt(dx * dx + dy * dy)
    if (dist > size * 0.42) return [255, 255, 255, 255]
    let angle = Math.atan2(dy, dx)
    if (angle < 0) angle += Math.PI * 2
    const wedge = Math.min(colors.length - 1, Math.floor((angle / (Math.PI * 2)) * colors.length))
    const [r, g, b] = colors[wedge] ?? [0, 0, 0]
    return [r, g, b, 255]
  })
}

// 4. Gradient mark — smooth two-hue diagonal gradient, no hard edges anywhere.
function gradientMark(): ImageData {
  const size = 160
  return makeImageData(size, size, (x, y) => {
    const t = (x + y) / (size * 2)
    const r = Math.round(255 * (1 - t) + 40 * t)
    const g = Math.round(80 * (1 - t) + 180 * t)
    const b = Math.round(200 * (1 - t) + 250 * t)
    return [r, g, b, 255]
  })
}

// 5. Mascot — flat-shaded cartoon character from overlapping circles (curved,
// naturally jagged raster boundaries — a good stress test for edge smoothing).
function mascot(): ImageData {
  const size = 200
  return makeImageData(size, size, (x, y) => {
    const bodyColor: [number, number, number] = [250, 180, 40]
    const headColor: [number, number, number] = [250, 200, 150]
    const eyeColor: [number, number, number] = [20, 20, 20]
    if (inCircle(x, y, size * 0.5, size * 0.68, size * 0.3)) return [...bodyColor, 255]
    if (inCircle(x, y, size * 0.5, size * 0.34, size * 0.24)) {
      if (inCircle(x, y, size * 0.42, size * 0.3, size * 0.035)) return [...eyeColor, 255]
      if (inCircle(x, y, size * 0.58, size * 0.3, size * 0.035)) return [...eyeColor, 255]
      return [...headColor, 255]
    }
    return [255, 255, 255, 255]
  })
}

// 6. Sticker — bold flat shape with a white die-cut ring, transparent outside it.
function sticker(): ImageData {
  const size = 160
  return makeImageData(size, size, (x, y) => {
    const cx = size / 2
    const cy = size / 2
    const dist = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2)
    if (dist > size * 0.46) return [0, 0, 0, 0]
    if (dist > size * 0.4) return [255, 255, 255, 255]
    const inner = dist < size * 0.22
    return inner ? [230, 40, 90, 255] : [250, 240, 245, 255]
  })
}

// 7. Icon — tiny canvas, one or two flat colors, a simple glyph.
function icon(): ImageData {
  const size = 32
  return makeImageData(size, size, (x, y) => {
    const shape = inCircle(x, y, size / 2, size / 2, size * 0.3)
    return shape ? [30, 140, 90, 255] : [255, 255, 255, 255]
  })
}

// 8. Low-resolution logo — same shape concept as simpleLogo, but at a tiny
// source resolution so pixel-stair-stepping is unavoidable, like a scaled-up
// favicon a real user might upload.
function lowResLogo(): ImageData {
  const size = 24
  return makeImageData(size, size, (x, y) => {
    const shape = inCircle(x, y, size / 2, size / 2, size * 0.34)
    return shape ? [40, 60, 220, 255] : [255, 255, 255, 255]
  })
}

// 9. Transparent PNG — soft alpha falloff (drop-shadow-style edges) over a
// fully transparent background, no flat "hard edge" anywhere.
function transparentPng(): ImageData {
  const size = 160
  return makeImageData(size, size, (x, y) => {
    const cx = size / 2
    const cy = size / 2
    const dist = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2)
    const r = size * 0.32
    if (dist > r + 12) return [0, 0, 0, 0]
    const alpha = dist <= r ? 255 : Math.round(255 * (1 - (dist - r) / 12))
    return [60, 120, 240, Math.max(0, alpha)]
  })
}

// 10. JPEG photo — continuous-tone photographic stand-in (soft radial
// lighting + per-pixel sensor-noise), encoded lossy — real compression
// artifacts come from the actual JPEG encoder, not simulated here.
function jpegPhoto(): ImageData {
  const size = 160
  const rng = makeRng(42)
  return makeImageData(size, size, (x, y) => {
    const cx = size * 0.45
    const cy = size * 0.4
    const dist = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2) / size
    const base = Math.max(0, 1 - dist * 1.1)
    const noise = (rng() - 0.5) * 18
    const r = 90 + base * 140 + noise
    const g = 70 + base * 110 + noise
    const b = 60 + base * 90 + noise
    return [r, g, b, 255]
  })
}

export function buildQualityTestImages(): QualityTestImage[] {
  return [
    { id: 'simple-logo', label: 'Simple logo (flat, hard edges)', category: 'simple logo', mimeType: 'image/png', imageData: simpleLogo() },
    { id: 'monochrome-logo', label: 'Monochrome logo (single ink color)', category: 'monochrome logo', mimeType: 'image/png', imageData: monochromeLogo() },
    { id: 'colorful-logo', label: 'Colorful logo (6 flat wedges)', category: 'colorful logo', mimeType: 'image/png', imageData: colorfulLogo() },
    { id: 'gradient', label: 'Gradient mark (smooth 2-hue blend)', category: 'gradient', mimeType: 'image/png', imageData: gradientMark() },
    { id: 'mascot', label: 'Mascot (flat-shaded character, curves)', category: 'mascot', mimeType: 'image/png', imageData: mascot() },
    { id: 'sticker', label: 'Sticker (die-cut ring + transparency)', category: 'sticker', mimeType: 'image/png', imageData: sticker() },
    { id: 'icon', label: 'Icon (32x32, 2 colors)', category: 'icon', mimeType: 'image/png', imageData: icon() },
    { id: 'low-res-logo', label: 'Low-resolution logo (24x24 source)', category: 'low-resolution logo', mimeType: 'image/png', imageData: lowResLogo() },
    { id: 'transparent-png', label: 'Transparent PNG (soft alpha falloff)', category: 'transparent PNG', mimeType: 'image/png', imageData: transparentPng() },
    { id: 'jpeg-photo', label: 'JPEG photo (continuous tone + noise)', category: 'JPEG photo', mimeType: 'image/jpeg', imageData: jpegPhoto() },
  ]
}
