/**
 * Engine option profiles for the two product trace modes, plus per-preset
 * adjustments for callers that request one of the legacy named presets.
 *
 *  - Quick Trace: bounded working resolution (1.5 MP) and a 32-color palette —
 *    fast, and already far above the old ImageTracer output (see BENCHMARKS.md).
 *  - Professional Trace: 2 MP working resolution (more super-sampling for
 *    small inputs), a larger palette and a finer color-merge distance.
 */
import type { TraceEngineOptions } from './traceImage'

export const QUICK_ENGINE_OPTIONS: Partial<TraceEngineOptions> = {
  // Enough for 2x super-sampling of typical ~600 px uploads: at 1x, large
  // curves flatten by up to ~0.75 px near their extremes.
  maxWorkingPixels: 1_500_000,
  maxColors: 32,
}

export const PROFESSIONAL_ENGINE_OPTIONS: Partial<TraceEngineOptions> = {
  maxWorkingPixels: 2_000_000,
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
