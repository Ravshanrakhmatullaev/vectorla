/**
 * Engine option profiles for the two product trace modes, plus per-preset
 * adjustments for callers that request one of the legacy named presets.
 *
 *  - Quick Trace: a 32-color palette; colors stay flat (good for print and cutting).
 *  - Professional Trace: a 64-color palette, a finer color-merge distance and
 *    gradient reconstruction (smooth ramps become real SVG gradients).
 *  Both share the same working-resolution caps (memory-bound, see below).
 */
import type { TraceEngineOptions } from './traceImage'

/**
 * Working-resolution caps for both modes (memory-bound; BENCHMARKS.md
 * "High-resolution engine"). Artwork is traced at up to 4 MP — every upload
 * the API accepts, at full resolution: measured inside workerd (the Workers
 * runtime), a 4 MP logo peaks at ~47 MB live (forced GC at every engine
 * checkpoint) and ~63 MB with no forced GC, about half of a Worker's 128 MB.
 * Photo-like images (see workingPixelCap) stay at 1.2 MP (~19 MB live):
 * posterized photos gain nothing from more pixels, while their region count,
 * SVG size, time and garbage grow with it (a 4 MP photo at full resolution
 * measured 61 MB live, ~129 MB without forced GC in Professional). Larger
 * images are reduced by a whole factor (exact k×k blocks).
 */
export const MAX_WORKING_PIXELS = 4_000_000
export const PHOTO_MAX_WORKING_PIXELS = 1_200_000

/**
 * Auto-upsampling caps (small images only): a 600 px logo at 2x, a 768x256
 * wordmark at 3x (Professional). Upsampled working sizes stay ≤ 2 MP.
 */
export const QUICK_MAX_UPSCALED_PIXELS = 1_500_000
export const PROFESSIONAL_MAX_UPSCALED_PIXELS = 2_000_000

export const QUICK_ENGINE_OPTIONS: Partial<TraceEngineOptions> = {
  maxWorkingPixels: MAX_WORKING_PIXELS,
  photoMaxWorkingPixels: PHOTO_MAX_WORKING_PIXELS,
  maxUpscaledPixels: QUICK_MAX_UPSCALED_PIXELS,
  maxColors: 32,
}

export const PROFESSIONAL_ENGINE_OPTIONS: Partial<TraceEngineOptions> = {
  maxWorkingPixels: MAX_WORKING_PIXELS,
  photoMaxWorkingPixels: PHOTO_MAX_WORKING_PIXELS,
  maxUpscaledPixels: PROFESSIONAL_MAX_UPSCALED_PIXELS,
  maxColors: 64,
  mergeDistance: 0.045,
  gradients: true,
}

/**
 * Legacy ImageTracer preset names (Job.preset is free-form and older clients
 * may send them) mapped to the engine settings that serve the same intent.
 */
const PRESET_ADJUSTMENTS: Record<string, Partial<TraceEngineOptions>> = {
  qrCode: { maxColors: 2, snapCorners: true },
  signature: { maxColors: 8 },
  blueprint: { maxColors: 8 },
  sketch: { denoise: 'on', speckleArea: 12 },
  photo: { maxColors: 64, denoise: 'on' },
  illustration: { maxColors: 48 },
}

export type SourceFormat = TraceEngineOptions['sourceFormat']

export function sourceFormatFromMime(mimeType: string): SourceFormat {
  switch (mimeType) {
    case 'image/png':
      return 'png'
    case 'image/jpeg':
      return 'jpeg'
    case 'image/webp':
      return 'webp'
    default:
      return 'unknown'
  }
}

export function engineOptionsFor(mode: 'quick' | 'professional', preset?: string | null): Partial<TraceEngineOptions> {
  const base = mode === 'professional' ? PROFESSIONAL_ENGINE_OPTIONS : QUICK_ENGINE_OPTIONS
  const adjustment = preset ? PRESET_ADJUSTMENTS[preset] : undefined
  return { ...base, ...adjustment }
}

/** The working-size caps of a profile, for decodeForTrace. */
export function workingCaps(options: Partial<TraceEngineOptions>): Pick<TraceEngineOptions, 'maxWorkingPixels' | 'photoMaxWorkingPixels'> {
  return { maxWorkingPixels: options.maxWorkingPixels ?? MAX_WORKING_PIXELS, photoMaxWorkingPixels: options.photoMaxWorkingPixels ?? PHOTO_MAX_WORKING_PIXELS }
}
