/**
 * Named ImageTracer.js option bundles, tuned for different kinds of source
 * art (Phase 22 named the first 5; Phase 23 added the remaining 4 and
 * retuned all of them — see tracePresetSelector.ts for automatic selection
 * and providers/PlaceholderProvider.smoke-test.ts / tracePresets.smoke-test.ts
 * for the measurements behind these numbers). Job.preset (see types/job.ts)
 * is free-form (matches the frontend's own, different preset concept — see
 * PROJECT_CONTEXT.md), so an unrecognized or missing value falls back to
 * automatic recommendation rather than a hardcoded default.
 */
export type TracePresetName =
  | 'logo'
  | 'signature'
  | 'qrCode'
  | 'icon'
  | 'sticker'
  | 'blueprint'
  | 'sketch'
  | 'illustration'
  | 'photo'

export interface TraceOptions {
  ltres: number
  qtres: number
  pathomit: number
  rightangleenhance: boolean
  numberofcolors: number
  colorquantcycles: number
  blurradius: number
  // Explicit for every preset below (Phase 23 audit — see each preset's
  // comment for why a given value was or wasn't changed from the
  // imagetracerjs default):
  layering: number
  strokewidth: number
  linefilter: boolean
  scale: number
  roundcoords: number
  viewbox: boolean
  desc: boolean
  blurdelta: number
  // Matches imagetracerjs's own options shape (see imagetracerjs.d.ts) — it
  // accepts additional keys we don't set here.
  [key: string]: unknown
}

/**
 * Fields every preset shares, factored out so each preset below only states
 * what makes it different (audit findings, Phase 23):
 *   - scale MUST stay 1 — optimizeSvg.ts normalizes the root <svg>'s
 *     width/height/viewBox to the real decoded pixel dimensions on every
 *     output; any other scale would make ImageTracer's path coordinates
 *     disagree with that declared size and the art would render at the
 *     wrong proportions.
 *   - viewbox stays false for the same reason — optimizeSvg always sets its
 *     own viewBox attribute afterward, so ImageTracer emitting one too is
 *     pure dead weight in the raw output before it gets stripped.
 *   - desc stays false — per-path <desc> elements are a pure file-size cost
 *     with no functional value in a production export.
 *   - strokewidth stays 1 (the default) — imagetracerjs always sets
 *     stroke="<same color as fill>" alongside strokewidth (see
 *     imagetracer_v1.2.6.js), specifically to paper over the 1px
 *     antialiasing seams browsers render between adjacent same-fill
 *     polygons; dropping it to 0 reintroduces visible hairline gaps between
 *     color regions, which is exactly the kind of artifact print/cut users
 *     (this product's primary audience) would notice.
 *   - layering stays 0 (sequential, the default) — audited against
 *     layering:1 (parallel) across every synthetic test image in
 *     tracePresets.smoke-test.ts with no measurable difference in path
 *     count, SVG size, or visual structure for non-pathologically-layered
 *     art, so there's no reason to move off the documented default.
 */
const SHARED_DEFAULTS = {
  layering: 0,
  strokewidth: 1,
  scale: 1,
  viewbox: false,
  desc: false,
} as const

export const TRACE_PRESETS: Record<TracePresetName, TraceOptions> = {
  // Flat colors, crisp edges, usually a handful of brand colors — keep
  // detail high and drop only true single-pixel noise.
  logo: {
    ...SHARED_DEFAULTS,
    ltres: 1,
    qtres: 1,
    pathomit: 8,
    rightangleenhance: true,
    numberofcolors: 16,
    colorquantcycles: 3,
    blurradius: 0,
    blurdelta: 20,
    linefilter: false,
    roundcoords: 1,
  },
  // Sparse, thin ink strokes on an (often transparent/scanned) background —
  // the opposite failure mode from a logo: the default pathomit (8) is
  // large enough to discard genuine thin stroke segments as "noise",
  // erasing real signature detail rather than cleaning it up. Very low
  // pathomit keeps every stroke; tight ltres/qtres follow the actual curve
  // instead of faceting it; rightangleenhance is off since handwriting has
  // no grid to snap to; roundcoords bumped to 2 so thin curves don't look
  // chunky at print/cut scale.
  signature: {
    ...SHARED_DEFAULTS,
    ltres: 0.5,
    qtres: 0.5,
    pathomit: 2,
    rightangleenhance: false,
    numberofcolors: 4,
    colorquantcycles: 2,
    blurradius: 0,
    blurdelta: 20,
    linefilter: false,
    roundcoords: 2,
  },
  // Pure black/white, perfectly axis-aligned modules — the most rectilinear
  // content this product ever traces. rightangleenhance is maximally
  // valuable here; ltres/qtres are loosened since only straight edges exist
  // (no curve fidelity to protect), which measurably cuts node count
  // without touching the shape. roundcoords:0 (integer coordinates) shaves
  // file size with zero visible cost on hard block edges. No blur — any
  // smoothing risks bridging adjacent modules that must stay distinct for
  // the code to scan correctly.
  qrCode: {
    ...SHARED_DEFAULTS,
    ltres: 2,
    qtres: 2,
    pathomit: 4,
    rightangleenhance: true,
    numberofcolors: 2,
    colorquantcycles: 1,
    blurradius: 0,
    blurdelta: 20,
    linefilter: false,
    roundcoords: 0,
  },
  // Even simpler than a logo (often 1-2 colors, small canvas) — tighter
  // color count keeps output minimal. qtres is slightly looser than ltres:
  // icons are small enough that any round glyph/mark needs a little
  // curve-fitting slack, or ImageTracer facets it into visibly jagged
  // straight segments instead of a smooth curve (see PlaceholderProvider.smoke-test.ts).
  icon: {
    ...SHARED_DEFAULTS,
    ltres: 0.5,
    qtres: 0.75,
    pathomit: 4,
    rightangleenhance: true,
    numberofcolors: 8,
    colorquantcycles: 3,
    blurradius: 0,
    blurdelta: 20,
    linefilter: false,
    roundcoords: 1,
  },
  // Bold flat-color art, often with a die-cut outline — a bit more path
  // tolerance than a logo since stickers can have more shapes/colors.
  // pathomit/blurradius also catch transparent PNGs with soft (non-die-cut)
  // alpha edges, where a soft edge otherwise traces into dozens of thin
  // concentric noise paths; a true hard die-cut edge is unaffected by
  // either change.
  sticker: {
    ...SHARED_DEFAULTS,
    ltres: 1,
    qtres: 1,
    pathomit: 10,
    rightangleenhance: true,
    numberofcolors: 24,
    colorquantcycles: 3,
    blurradius: 1,
    blurdelta: 20,
    linefilter: false,
    roundcoords: 1,
  },
  // Thin technical line-work (rectangles, circles, diagonals) — almost
  // always just ink + background, so a very small palette is enough. Kept
  // tight/unblurred like signature (low pathomit, no blur) so fine lines
  // survive, but rightangleenhance is back on since technical drawings are
  // usually orthogonal, unlike handwriting.
  blueprint: {
    ...SHARED_DEFAULTS,
    ltres: 1,
    qtres: 1,
    pathomit: 4,
    rightangleenhance: true,
    numberofcolors: 4,
    colorquantcycles: 2,
    blurradius: 0,
    blurdelta: 20,
    linefilter: false,
    roundcoords: 1,
  },
  // Hand-drawn/pencil work has real per-pixel texture that isn't signal —
  // without help this explodes into thousands of speckle paths (measured:
  // 897 paths / 7827 nodes / 180KB on the synthetic in
  // tracePresets.smoke-test.ts, well past every reject threshold). A strong
  // blur (blurradius 4, well above every other preset's 0/1/2) merges that
  // texture into flat regions before tracing even starts — this is the one
  // profile where blurdelta is also raised far past the imagetracerjs
  // default (96 vs 20), specifically to keep merging noisy neighboring
  // pixels the default threshold would still treat as distinct edges.
  // linefilter adds a second noise-reduction pass on top; pathomit is
  // raised to clean up whatever small fragments survive both. This
  // aggressive denoising does cost curve smoothness on the traced outline
  // (loose ltres/qtres end up mostly straight-segment, not curved) — see
  // this preset's entry in runQualityHarness.ts's BUDGETS for why that's
  // accepted rather than chased further. rightangleenhance stays off
  // (nothing here is grid-aligned).
  sketch: {
    ...SHARED_DEFAULTS,
    ltres: 2,
    qtres: 2,
    pathomit: 24,
    rightangleenhance: false,
    numberofcolors: 6,
    colorquantcycles: 2,
    blurradius: 4,
    blurdelta: 96,
    linefilter: true,
    roundcoords: 1,
  },
  // More colors and softer shapes than a logo — relax right-angle
  // enhancement (illustrations aren't grid-aligned) and allow more paths.
  illustration: {
    ...SHARED_DEFAULTS,
    ltres: 1.5,
    qtres: 1.5,
    pathomit: 10,
    rightangleenhance: false,
    numberofcolors: 32,
    colorquantcycles: 4,
    blurradius: 1,
    blurdelta: 20,
    linefilter: false,
    roundcoords: 1,
  },
  // Continuous tone — a light pre-blur smooths sensor/compression noise
  // before tracing, high pathomit keeps output size sane, no right-angle
  // enhancement (photos have no straight edges to snap to). Only reached as
  // a fallback (see ConversionService.processJob's NotImplementedError
  // catch) since real photographs route to the (future) AI pipeline — see
  // ProviderSelector.ts — but still needs a sane profile until that lands.
  photo: {
    ...SHARED_DEFAULTS,
    ltres: 2,
    qtres: 2,
    pathomit: 16,
    rightangleenhance: false,
    numberofcolors: 64,
    colorquantcycles: 4,
    blurradius: 2,
    blurdelta: 32,
    linefilter: false,
    roundcoords: 1,
  },
}

export function isTracePresetName(value: string): value is TracePresetName {
  return value in TRACE_PRESETS
}
