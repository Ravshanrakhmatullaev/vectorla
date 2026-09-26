/**
 * Perceptual color math for the Vectorla tracing engine.
 *
 * Palette extraction and pixel labeling work in OKLab (Björn Ottosson, 2020):
 * Euclidean distance there tracks perceived color difference far better than
 * RGB distance, so "merge colors closer than X" means the same thing for dark
 * blues and light yellows. Anti-aliasing mixtures, on the other hand, are
 * linear in *linear-light* RGB, so mixture tests use that space.
 */

const SRGB_TO_LINEAR = new Float32Array(256)
for (let i = 0; i < 256; i++) {
  const c = i / 255
  SRGB_TO_LINEAR[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
}

export function srgbToLinear(value: number): number {
  return SRGB_TO_LINEAR[value] ?? 0
}

export interface Lab {
  L: number
  a: number
  b: number
}

/** 8-bit sRGB -> OKLab, writing into `out` at `offset` (L, a, b). */
export function rgbToOklabInto(r: number, g: number, b: number, out: Float32Array, offset: number): void {
  const lr = SRGB_TO_LINEAR[r] ?? 0
  const lg = SRGB_TO_LINEAR[g] ?? 0
  const lb = SRGB_TO_LINEAR[b] ?? 0
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb)
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb)
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb)
  out[offset] = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s
  out[offset + 1] = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s
  out[offset + 2] = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
}

export function rgbToOklab(r: number, g: number, b: number): Lab {
  const out = new Float32Array(3)
  rgbToOklabInto(r, g, b, out, 0)
  return { L: out[0] ?? 0, a: out[1] ?? 0, b: out[2] ?? 0 }
}

export function toHex(r: number, g: number, b: number): string {
  const hex = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')
  return `#${hex(r)}${hex(g)}${hex(b)}`
}

/** Shortest equivalent hex form (#aabbcc -> #abc) for smaller SVG output. */
export function toShortHex(r: number, g: number, b: number): string {
  const full = toHex(r, g, b)
  if (full[1] === full[2] && full[3] === full[4] && full[5] === full[6]) {
    return `#${full[1]}${full[3]}${full[5]}`
  }
  return full
}
