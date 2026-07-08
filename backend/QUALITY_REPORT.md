# Phase 23 — Real-World Quality Testing Report

## Method and an important caveat

No real user-submitted images are available in this environment. Instead,
`src/testSupport/qualityTestImages.ts` procedurally builds one synthetic
stand-in per requested category, chosen to carry that category's defining
visual traits (flat vs. gradient color, hard vs. soft edges, transparency,
source resolution). Each is encoded to real PNG/JPEG bytes (via jSquash,
the same encoder the frontend's uploads would produce) and run through the
**actual production pipeline** — `PlaceholderProvider`: decode → analyze →
ImageTracer → `optimizeSvg` — exercised by
`src/qualityTesting/runQualityHarness.ts`.

"Output quality" is scored from structural signals in the traced SVG
(`src/qualityTesting/svgQualityMetrics.ts`), not a visual render — this
environment cannot display or diff images. That's a real limitation: these
proxy metrics (path count, average path size, curve-vs-line command ratio)
correlate with common failure modes but are not a substitute for a human
looking at the output. Treat this report as a structural regression check,
not a design sign-off.

Run it yourself: `npx tsx src/qualityTesting/runQualityHarness.ts` (from
`backend/`).

## Results (after the preset changes below)

| Category | Source | Time | SVG size | Paths | Curve ratio | Detected preset | Problems |
|---|---|---|---|---|---|---|---|
| Simple logo (flat, hard edges) | 128x128 PNG | ~65–160ms | 1.0 KB | 2 | high | icon | none |
| Monochrome logo (single ink color) | 128x128 PNG | ~16–19ms | 0.7 KB | 3 | n/a (no curves) | icon | none |
| Colorful logo (6 flat wedges) | 160x160 PNG | ~27–28ms | 1.7 KB | 7 | high | logo | none |
| Gradient mark (smooth 2-hue blend) | 160x160 PNG | ~200–375ms | 5.0 KB | 28 | — | illustration | none |
| Mascot (flat-shaded character, curves) | 200x200 PNG | ~43–91ms | 2.9 KB | 5 | **fixed** | icon | none |
| Sticker (die-cut ring + transparency) | 160x160 PNG | ~77–155ms | 2.1→2.7 KB | 4→6 | high | sticker | none |
| Icon (32x32, 2 colors) | 32x32 PNG | ~1.5–2.0ms | 0.6 KB | 2 | high | icon | none |
| Low-resolution logo (24x24 source) | 24x24 PNG | ~1.0–1.1ms | 0.6 KB | 2 | **fixed** | icon | none |
| Transparent PNG (soft alpha falloff) | 160x160 PNG | ~90–119ms | **37.8→12.5 KB** | **231→59** | **fixed** | sticker | none |
| JPEG photo (continuous tone + noise) | 160x160 JPEG | ~183–225ms | 174.4 KB | 809 | — | illustration | none |

Processing time ranges reflect run-to-run JIT/cold-start noise on this
machine (`performance.now()` around a single WASM decode + trace call) —
not something the harness should chase precision on. Nothing here is close
to a timeout concern (worst case ~375ms for the gradient case).

## Problems found (before the preset changes)

Initial run flagged 3 of 10 categories:

1. **Mascot → jagged edges.** Auto-detected as the `icon` preset (few flat
   colors, low complexity). `icon`'s `qtres: 0.5` was tight enough that
   round silhouettes (the head/body circles) were being faceted into
   straight line segments (`curveCommandRatio` under the 0.15 floor) instead
   of smooth quadratic curves.
2. **Low-resolution logo → jagged edges.** Same root cause as the mascot —
   also auto-detected as `icon`, same tight `qtres`.
3. **Transparent PNG (soft alpha falloff) → too many paths (231) + jagged
   edges.** Auto-detected as `sticker` (transparency + moderate color
   count). A soft alpha gradient isn't what that preset was tuned for (real
   stickers have a hard die-cut edge) — ImageTracer was tracing the alpha
   falloff as dozens of thin, faceted concentric bands, producing a 37.8 KB
   SVG for what should be a simple soft-edged blob.

No category showed missing-detail (path counts implausibly low for their
shape count) or oversized-SVG problems against the budgets in
`runQualityHarness.ts`'s `BUDGETS` table.

## Improvements made

Two numeric tweaks in `src/providers/tracePresets.ts` (`TRACE_PRESETS`
values only — no restructuring, no new options, no changes to preset
selection/`analyzeImage` logic):

- **`icon` preset**: `qtres` raised from `0.5` to `0.75`. `ltres` (line
  fitting) stays tight so sharp corners are still preserved on non-round
  icons; only the curve-fitting tolerance loosened, which is what let round
  silhouettes trace as smooth curves instead of faceted lines.
- **`sticker` preset**: `pathomit` raised from `6` to `10`, `blurradius`
  raised from `0` to `1`. A one-pixel pre-blur and slightly higher
  minimum-path-size cutoff both specifically suppress the kind of thin,
  noisy fragments a soft alpha edge produces — a true hard die-cut edge
  (the sticker test case itself) is essentially undisturbed by either
  change (4→6 paths, 2.1→2.7 KB, still well under budget).

**Result:** all 3 flagged problems resolved. The transparent-PNG case is the
biggest win — 231→59 paths and 37.8→12.5 KB. Re-ran the existing
`imageAnalysis.smoke-test.ts`, `PlaceholderProvider.smoke-test.ts`, and
`ProviderFactory.smoke-test.ts` — all still pass (they assert generic
properties like "produces output" / "recommends a real preset", not exact
byte-for-byte SVG content, so the tuning doesn't break anything).

## Remaining weaknesses

- **Preset detection has a real gap for soft-transparency images.**
  `analyzeImage`'s heuristic routes any image with transparency + moderate
  color count to `sticker`, which conflates two genuinely different real
  inputs: a die-cut sticker (hard edge, flat colors — what the preset is
  actually tuned for) and a soft cutout/shadow PNG (gradual alpha falloff).
  The preset tweak above makes the soft case less bad, but a dedicated
  preset (or a transparency-gradient signal in `analyzeImage`) would fit
  better. Out of scope here — Phase 23 explicitly limited this pass to
  preset value tuning, not the recommendation heuristic.
- **JPEG photo output is large (174 KB, 809 paths) and untuned this pass.**
  It didn't breach the (deliberately generous) photo budget, but 174 KB is
  a lot for a "vector" deliverable, and print/cut users are the product's
  primary audience (see `PROJECT_CONTEXT.md`) — photos are a secondary use
  case at best. Left alone rather than risk-tuning a category outside this
  phase's focus (logos/icons/stickers), but it's the clearest next target
  if photo tracing becomes a priority.
- **Metrics are structural proxies, not a visual quality signal**, as noted
  above — `curveCommandRatio` and path-fragment size are reasonable stand-
  ins for "faceted" and "noisy" but can't catch problems like wrong colors,
  a shape traced with the wrong topology, or acceptable-looking output that
  still reads as visually "off." A real regression suite eventually needs
  either rendered pixel-diffing or human review of a rendered SVG, neither
  of which exists yet.
- **Only synthetic test images**, not real user uploads — see the caveat at
  the top. The categories were chosen and modeled by hand; they're a
  reasonable approximation but could miss failure modes real logos (e.g.
  fine text, thin strokes, drop shadows layered over photos) would surface.
