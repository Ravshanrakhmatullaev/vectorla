/**
 * Engine option profiles for the two product trace modes, plus per-preset
 * adjustments for callers that request one of the legacy named presets.
 *
 *  - Quick Trace: a 32-color palette; colors stay flat (good for print and cutting).
 *  - Professional Trace: a 64-color palette, a finer color-merge distance and
 *    gradient reconstruction (smooth ramps become real SVG gradients).
 *  Both share the same working-resolution cap (memory-bound, see below).
 */
import type { TraceEngineOptions } from './traceImage'

/**
 * Working-resolution cap for both modes. Peak live memory is ~35 bytes per
 * working pixel (measured with forced GC), and a Worker has 128 MB in total,
 * so 1.2 MP keeps a trace near 40 MB. It still allows 2x super-sampling of
 * 512 px uploads and 4x of 256 px ones; on the 80-image benchmark it matches
 * the previous 1.5 MP (Quick) and 2 MP (Professional) caps within 0.004 ΔE.
 */
export const MAX_WORKING_PIXELS = 1_200_000

/**
 * Auto-upsampling caps (small images only). A source small enough to be
 * upsampled costs a few MB to decode, so the trace itself may use more of the
 * budget than MAX_WORKING_PIXELS allows: these are the caps both modes used
 * before the 1.2 MP working limit (Professional at 2 MP measured ~66 MB live),
 * and they keep e.g. a 600 px logo at 2x and a 768x256 wordmark at 3x.
 */
export const QUICK_MAX_UPSCALED_PIXELS = 1_500_000
export const PROFESSIONAL_MAX_UPSCALED_PIXELS = 2_000_000

export const QUICK_ENGINE_OPTIONS: Partial<TraceEngineOptions> = {
  maxWorkingPixels: MAX_WORKING_PIXELS,
  maxUpscaledPixels: QUICK_MAX_UPSCALED_PIXELS,
  maxColors: 32,
}

export const PROFESSIONAL_ENGINE_OPTIONS: Partial<TraceEngineOptions> = {
  maxWorkingPixels: MAX_WORKING_PIXELS,
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
