/**
 * Named ImageTracer.js option bundles, tuned for different kinds of source
 * art. Job.preset (see types/job.ts) is free-form (matches the frontend's
 * own, different preset concept — see PROJECT_CONTEXT.md), so an unrecognized
 * or missing value falls back to automatic recommendation (see
 * imageAnalysis.ts) rather than a hardcoded default.
 */
export type TracePresetName = 'logo' | 'icon' | 'sticker' | 'illustration' | 'photo'

export interface TraceOptions {
  ltres: number
  qtres: number
  pathomit: number
  rightangleenhance: boolean
  numberofcolors: number
  colorquantcycles: number
  blurradius: number
  // Matches imagetracerjs's own options shape (see imagetracerjs.d.ts) — it
  // accepts additional keys we don't set here.
  [key: string]: unknown
}

export const TRACE_PRESETS: Record<TracePresetName, TraceOptions> = {
  // Flat colors, crisp edges, usually a handful of brand colors — keep
  // detail high and drop only true single-pixel noise.
  logo: { ltres: 1, qtres: 1, pathomit: 8, rightangleenhance: true, numberofcolors: 16, colorquantcycles: 3, blurradius: 0 },
  // Even simpler than a logo (often 1-2 colors, small canvas) — tighter
  // color count keeps output minimal. qtres is slightly looser than ltres
  // (Phase 23 quality testing): icons are small enough that any round
  // glyph/mark needs a little curve-fitting slack, or ImageTracer facets it
  // into visibly jagged straight segments instead of a smooth curve.
  icon: { ltres: 0.5, qtres: 0.75, pathomit: 4, rightangleenhance: true, numberofcolors: 8, colorquantcycles: 3, blurradius: 0 },
  // Bold flat-color art, often with a die-cut outline — a bit more path
  // tolerance than a logo since stickers can have more shapes/colors.
  // pathomit/blurradius bumped slightly (Phase 23 quality testing): this
  // preset also catches transparent PNGs with soft (non-die-cut) alpha
  // edges, where a soft edge otherwise traces into dozens of thin
  // concentric noise paths; a true hard die-cut edge is unaffected by
  // either change.
  sticker: { ltres: 1, qtres: 1, pathomit: 10, rightangleenhance: true, numberofcolors: 24, colorquantcycles: 3, blurradius: 1 },
  // More colors and softer shapes than a logo — relax right-angle
  // enhancement (illustrations aren't grid-aligned) and allow more paths.
  illustration: { ltres: 1.5, qtres: 1.5, pathomit: 10, rightangleenhance: false, numberofcolors: 32, colorquantcycles: 4, blurradius: 1 },
  // Continuous tone — a light pre-blur smooths sensor/compression noise
  // before tracing, high pathomit keeps output size sane, no right-angle
  // enhancement (photos have no straight edges to snap to).
  photo: { ltres: 2, qtres: 2, pathomit: 16, rightangleenhance: false, numberofcolors: 64, colorquantcycles: 4, blurradius: 2 },
}

export function isTracePresetName(value: string): value is TracePresetName {
  return value in TRACE_PRESETS
}
