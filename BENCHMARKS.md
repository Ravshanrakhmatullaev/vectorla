# Vectorla — Vector Quality Benchmarks

The primary product metric is **vector output quality**. This file records how
it is measured, the current numbers, and how they compare with what
professional vectorization tools deliver.

## Methodology: render-and-diff against ground-truth vectors

Structural proxies (path counts, "curve ratio") cannot tell whether a trace
*looks right*. The benchmark therefore starts from vectors whose correct answer
is known:

1. **Ground truth.** `backend/src/benchmark/corpus.ts` holds 13 hand-authored
   SVG designs covering the customer categories: flat logo, wordmark (real
   font text, including small 12 px subtitle text at the low-res variant), line
   icon, die-cut sticker with transparency, fine-detail badge (thin rings,
   24 small dots), multi-color wedges (3-color junctions), cartoon mascot with
   outlines, three gradient designs (2-stop linear mark, 3-stop linear banner
   with flat shapes on top, radial glow), QR code, blueprint line art, and a
   signature.
2. **Customer-like rasters.** Each design is rendered anti-aliased (resvg) at
   1–3 source sizes (64 px to 768 px), encoded as PNG or JPEG (q75) exactly
   like an upload, and decoded through the production decoder: 25 variants in all.
3. **Trace** with each engine.
4. **Render the traced SVG back at 4× the source size** (capped at 2400 px)
   and compare it with the ground truth rendered at the same 4× size. Because
   the reference is a real vector, this measures what a customer sees when zooming
   in: shape accuracy, corner sharpness, curve smoothness, color fidelity,
   gaps.

### Metrics

| Metric | Meaning |
|---|---|
| **ΔE×100** | Mean OKLab color difference over all pixels (composited on white). ≈1 is a just-noticeable difference. |
| **Bad px %** | Pixels with ΔE > 0.10, meaning visibly wrong color or a misplaced edge. |
| **Edge err (px)** | Mean boundary displacement in *source* pixels: bad-pixel area ÷ ground-truth edge length. |
| **Gaps/10k** | Pixels deep inside opaque artwork (≥ 2 eval px from any edge) that the trace leaves see-through: seams and holes. |
| **Segments** | Drawing segments (lines + Béziers), i.e. the node count a designer edits. |
| **KB** | SVG file size. |

### Running it

```bash
cd backend
npm run bench                                    # quick, professional, legacy
npm run bench -- --engines=professional --cases=wordmark,qr-like --out=/tmp/bench
npx tsx src/benchmark/qualityGate.smoke-test.ts  # regression gate (also part of npm test)
npm run bench -- --corpus=real --memory --compare # real-world corpus, peak memory, vs baseline-realworld.json
npx tsx src/benchmark/realWorldGate.smoke-test.ts  # real-world regression gate (also part of npm test)
```

`--out` writes each source raster, traced SVG and 4× render for visual review.

## Real-world corpus (2026-10-03)

The core corpus above is small and author-drawn. A second corpus,
`backend/src/benchmark/realWorldCorpus.ts`, holds **55 images** in the shapes
real uploads take. Sources and licenses are listed in
`backend/src/benchmark/assets/SOURCES.md`; all are MIT, ISC, CC0 or public domain.

| Category | Images | What they test |
|---|---:|---|
| illustration | 14 | Microsoft Fluent Emoji (flat), incl. 64 px, JPEG and blurred (σ 1.2) variants |
| gradient | 7 | Fluent Emoji (3D-style color), shaded gradients and highlights |
| icon | 12 | Lucide line icons at 48 px and 192 px (1.5–2 px strokes, round joins) |
| logo | 4 | Badge logo with text: 128 px, 512 px, 512 px JPEG q40, 256 px blurred (σ 1.5) |
| text | 4 | Serif / italic body text (1024 and 512 px), white-on-dark text (PNG and JPEG) |
| thin-lines | 2 | 0.5–1.5 px hairlines, diagonals, dashed circles, grids |
| intricate | 2 | Ornament with fine repeated detail (512 and 160 px) |
| geometric | 2 | Hexagon mosaic, many 3-color junctions (PNG and JPEG) |
| photo | 6 | scikit-image sample photos (JPEG) |
| scan | 2 | Scanned text and a silhouette |

Vector-sourced images are scored against their SVG rendered at 4×, as above.
Photos and scans have no vector truth, so they are scored against the source
raster at 1× (ΔE and bad pixels only). One more metric is reported:
**edge-length ratio** (traced edge length ÷ true edge length). Values well below 1
mean lost detail (hairlines, small text); values well above 1 mean noise or jaggies.

### Before and after (55 images)

| Metric | Quick before | Quick after | Professional before | Professional after |
|---|---:|---:|---:|---:|
| Mean ΔE×100 | 0.85 | **0.74** | 1.14 | **0.68** |
| Mean bad px % | 1.92 | **1.36** | 3.19 | **1.33** |
| Mean edge error (px)¹ | 0.14 | **0.13** | 0.18 | **0.13** |
| Mean seams / 10k¹ | 9.3 | **0.0** | 6.3 | **0.0** |
| Photos: mean ΔE×100 | 3.47 | **2.88** | 6.18 | **2.71** |
| Total SVG size (KB) | 3,577 | 5,069 | 2,150 | 5,732 |
| Max process RSS (MB)² | 131 | 120 | 161 | 157 |
| Failed traces | 0 | 0 | 0 | 0 |

¹ Vector-reference images only. ² Resident set size of a Node child process
running one trace (`--memory`); it overstates the live heap (see "Memory").

Notable cases: thin-lines@256 ΔE 1.69 → 0.70 (Quick) / 0.58 (Professional),
edge-length ratio 0.32 → 0.94 / 1.04. typo-serif@512 1.03 → 0.92.
photo-chelsea (Professional) 6.13 → 2.58. emoji-unicorn seams 28/10k → 0.

### After, by category

| Category | Engine | Images | ΔE×100 | Bad px % | Edge err (px) | Edge-length ratio | Segments (mean) | KB (mean) | ms (mean) |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|
| illustration | quick | 14 | 0.14 | 0.35 | 0.08 | 1.04 | 166 | 4.6 | 792 |
| illustration | professional | 14 | 0.11 | 0.34 | 0.07 | 1.03 | 172 | 4.7 | 846 |
| illustration | legacy | 14 | 1.00 | 2.93 | 0.88 | 1.13 | 1046 | 30.1 | 116 |
| gradient | quick | 7 | 0.76 | 0.40 | 0.16 | 1.00 | 1774 | 48.6 | 836 |
| gradient | professional | 7 | 0.65 | 0.40 | 0.16 | 0.99 | 1620 | 46.3 | 1063 |
| gradient | legacy | 7 | 1.03 | 1.42 | 0.56 | 1.11 | 1257 | 30.0 | 126 |
| icon | quick | 12 | 0.61 | 1.85 | 0.13 | 1.02 | 43 | 1.2 | 191 |
| icon | professional | 12 | 0.61 | 1.85 | 0.13 | 1.02 | 43 | 1.2 | 220 |
| icon | legacy | 12 | 2.65 | 4.96 | 0.38 | 1.29 | 505 | 16.3 | 30 |
| logo | quick | 4 | 0.79 | 1.59 | 0.24 | 0.89 | 745 | 19.5 | 914 |
| logo | professional | 4 | 0.47 | 1.49 | 0.21 | 0.89 | 793 | 21.2 | 1010 |
| logo | legacy | 4 | 2.00 | 5.06 | 0.73 | 1.18 | 6156 | 197.3 | 314 |
| text | quick | 4 | 0.46 | 1.23 | 0.21 | 0.87 | 1176 | 28.5 | 911 |
| text | professional | 4 | 0.46 | 1.23 | 0.21 | 0.87 | 1176 | 28.5 | 935 |
| text | legacy | 4 | 1.50 | 4.30 | 1.01 | 1.08 | 6197 | 156.9 | 584 |
| thin-lines | quick | 2 | 0.48 | 1.33 | 0.17 | 1.04 | 528 | 11.7 | 864 |
| thin-lines | professional | 2 | 0.42 | 1.31 | 0.17 | 1.09 | 585 | 13.1 | 952 |
| thin-lines | legacy | 2 | 2.01 | 4.22 | 0.58 | 0.63 | 692 | 15.6 | 178 |
| intricate | quick | 2 | 0.32 | 1.28 | 0.12 | 0.99 | 281 | 9.7 | 733 |
| intricate | professional | 2 | 0.32 | 1.28 | 0.12 | 0.99 | 281 | 9.7 | 680 |
| intricate | legacy | 2 | 1.54 | 3.86 | 0.35 | 1.13 | 2412 | 77.7 | 142 |
| geometric | quick | 2 | 0.22 | 0.35 | 0.08 | 0.86 | 1176 | 29.0 | 1042 |
| geometric | professional | 2 | 0.22 | 0.35 | 0.08 | 0.86 | 1196 | 29.3 | 1226 |
| geometric | legacy | 2 | 1.07 | 2.57 | 0.56 | 1.18 | 13462 | 321.6 | 684 |
| photo | quick | 6 | 2.88 | 4.30 | n/a | n/a | 23583 | 637.7 | 1909 |
| photo | professional | 6 | 2.71 | 4.18 | n/a | n/a | 27172 | 740.7 | 2679 |
| photo | legacy | 6 | 4.28 | 8.41 | n/a | n/a | 35219 | 987.4 | 583 |
| scan | quick | 2 | 0.99 | 0.91 | n/a | n/a | 9810 | 265.7 | 1357 |
| scan | professional | 2 | 0.98 | 0.82 | n/a | n/a | 10746 | 290.4 | 1435 |
| scan | legacy | 2 | 4.07 | 9.25 | n/a | n/a | 15618 | 510.8 | 251 |

| Engine | Case | Variant | ΔE×100 | Edge err (px) | Segments | KB | Verdict |

### What changed

1. **Gradient validation (Professional).** `validateGradientGroups`
   (engine/gradients.ts) keeps a fitted gradient on a region only if its squared
   error over the region's pixels is no worse than the region's flat palette
   color. Before this, photos were merged into a few smeared gradient regions.
2. **Seam-free stacking.** Before each later-drawn neighbour, a shape gets a 1-source-px
   stroke of its own color along their shared edge (`underlay` option,
   engine/traceImage.ts). This closes the hairline gaps renderers leave between
   anti-aliased shapes that share an edge. The strokes are `fill="none"` paths
   and are counted separately (`underlaySegments`) from the editable shapes.
3. **Coverage-preserving thin features.** labelPixels (engine/palette.ts) used
   to give each anti-aliased pixel to the nearer side of its blend, so a stroke
   under ~1 px wide, with no pixel above 50% coverage, vanished. Now a pixel is
   promoted to the stroke color when the coverage summed over its neighbourhood
   says a stroke is there and no near-solid pixel of that color is nearby (wide
   shapes keep their exact edges).
4. **Blend-tint palette filter.** A detail color accepted before its pure color
   (e.g. an 80% ink / 20% paper tint at small italic text) is dropped when a
   later color explains it as a blend. The tint had been taking the stroke's
   edge pixels, which were then merged into the background.
5. **Memory limits** (see below).

Every change was A/B-tested on all 80 images (core + real). None makes any
category worse beyond ±0.01 except where listed under trade-offs.

### Memory

A Worker has 128 MB, and WebAssembly memory never shrinks. Measured in Node with
the production decoders and forced GC:

- Decoding costs about 12 bytes per source pixel: 4 MP JPEG +48 MB, 12 MP +140 MB, 24 MP +280 MB.
- Tracing peaks at about 35 bytes per working pixel live: 1.2 MP ≈ 40 MB, 2 MP ≈ 66 MB.

The old limits (24 MP uploads, 1.5–2 MP working size) could exceed 128 MB on a
phone photo. Now:

- `MAX_IMAGE_PIXELS` is 4 MP: the API rejects larger images with a clear message.
- The web app downscales larger images in the browser before upload
  (`src/utils/fitImageForUpload.ts`). It also re-encodes an opaque PNG that would
  exceed the free plan's 5 MB as a high-quality JPEG.
- Large images are traced at 1.2 MP (`MAX_WORKING_PIXELS`).
- Small images may still be upsampled to 1.5 MP (Quick) or 2 MP (Professional),
  since their decode cost is a few MB.
- `downscaleArea` now streams rows instead of allocating a full-size float buffer.

Over all 80 images, the 1.2 MP cap matches the previous caps to within 0.004 ΔE.

### Trade-offs and limitations

- **File size.** Underlay strokes add about 40–60% to graphics SVGs (core
  corpus: Quick 92.6 → 113.3 KB in total). Professional photo and scan SVGs grew
  from 1.7 MB to 5.0 MB in total, because they are no longer collapsed into a few
  smeared gradients. The underlay can be disabled with `underlay: 0`, at the
  cost of seams.
- **Small losses.** hex-mosaic JPEG +0.02 ΔE (the thin-feature rule reacts to
  JPEG noise; on all JPEGs together it is a net gain). wedges@128 and two
  gradient cases +0.01 edge error (underlay).
- **Still weak.** Serifs and joins in text under ~10 px stroke height. Diagonal
  strokes near 1.5 px wide can come out dashed. Quick on a heavily compressed
  JPEG logo (q40) merges the pale circle fill with the white background (ΔE 1.60
  vs 0.37 Professional). Photos are posterized, as expected from a region tracer.
- **Not measured.** Head-to-head against commercial vectorizers, which would
  need paid API access. Memory is measured in Node, not inside workerd.

## Core corpus results (2026-10-03)

Engines:

- **professional**: Vectorla engine, Professional profile (64 colors, finer color merge, gradient reconstruction; 1.2 MP working size, small images upsampled up to 2 MP).
- **quick**: Vectorla engine, Quick profile (32 colors; 1.2 MP working size, small images upsampled up to 1.5 MP).
- **legacy**: the pre-engine production path (image analysis → named preset →
  ImageTracer → regex SVG cleanup). It is kept as the fallback provider.

### Summary (25 variants)

| Engine | Mean ΔE×100 | Mean bad px % | Mean edge err (px) | Mean gaps/10k | Total segments | Total KB | Total ms |
|---|---:|---:|---:|---:|---:|---:|---:|
| **professional** | **0.17** | **0.46** | **0.12** | **0.0** | 3,724 | 90.5 | 21,200 |
| **quick** | **0.29** | **0.46** | **0.11** | **0.0** | 4,575 | 113.3 | 18,323 |
| legacy (ImageTracer) | 0.95 | 1.59 | 0.40 | 22.7 | 44,035 | 1,320.4 | 7,207 |
| legacy Professional pipeline (removed, 22-variant corpus) | 4.37 | 13.47 | 5.95 | n/a¹ | 51,424 | 1,644.0 | 7,487 |

¹ Measured before the gap metric was restricted to interior pixels; its visual
failure was gross edge displacement (up to 23 px) caused by whole-image
quantization and auto-levels running before tracing.

Compared with the legacy path, Professional delivers **5.6× lower color error, 3.3× lower
edge error, zero gaps/seams, 12× fewer nodes and 15× smaller files**. Neither
mode is worse than legacy on any flat-art variant; the quality gate enforces
this. On gradients Quick posterizes by design and is only required to stay within 1.2×
of legacy. The committed reference run is `backend/src/benchmark/baseline.json`;
`npm run bench -- --compare` prints per-variant regressions against it.

**Gradients (Professional only).** Posterized bands are merged back into
single regions filled with fitted `<linearGradient>` / `<radialGradient>`
definitions. This improves gradient-mark 0.58 → 0.06, gradient-banner 1.06 → 0.15
(JPEG 1.00 → 0.23), and radial-glow 0.76 → 0.04, with no change on any flat-art case.

### Per variant

| Case | Source | Professional ΔE / edge px / segs / KB | Quick ΔE / edge px / segs / KB | Legacy ΔE / edge px / gaps / segs / KB |
|---|---|---|---|---|
| flat-logo | 128 | 0.14 / 0.10 / 44 / 1.0 | 0.14 / 0.10 / 44 / 1.0 | 1.29 / 0.37 / 18.8 / 397 / 9.0 |
| flat-logo | 512 | 0.04 / 0.08 / 49 / 1.1 | 0.04 / 0.08 / 49 / 1.1 | 0.21 / 0.36 / 4.0 / 427 / 20.6 |
| flat-logo | 512jpg | 0.12 / 0.10 / 100 / 2.2 | 0.12 / 0.10 / 95 / 2.1 | 0.81 / 0.38 / 23.4 / 4092 / 117.7 |
| wordmark | 256 | 0.60 / 0.16 / 208 / 5.2 | 0.60 / 0.16 / 208 / 5.2 | 2.26 / 0.50 / 35.6 / 1080 / 24.7 |
| wordmark | 768 | 0.18 / 0.18 / 331 / 6.0 | 0.20 / 0.19 / 277 / 5.9 | 1.16 / 0.41 / 9.4 / 2697 / 51.3 |
| wordmark | 768jpg | 0.23 / 0.19 / 367 / 7.1 | 0.27 / 0.20 / 320 / 6.5 | 1.10 / 0.76 / 84.7 / 6757 / 212.1 |
| line-icon | 64 | 0.29 / 0.08 / 33 / 0.6 | 0.29 / 0.08 / 33 / 0.6 | 2.93 / 0.63 / 6.9 / 160 / 4.7 |
| line-icon | 256 | 0.07 / 0.08 / 62 / 0.9 | 0.07 / 0.08 / 62 / 0.9 | 0.73 / 0.44 / 0.9 / 266 / 12.6 |
| sticker | 160 | 0.06 / 0.07 / 37 / 1.2 | 0.06 / 0.07 / 37 / 1.2 | 0.26 / 0.34 / 8.6 / 418 / 17.3 |
| sticker | 512 | 0.02 / 0.09 / 45 / 1.6 | 0.02 / 0.09 / 45 / 1.6 | 0.07 / 0.34 / 4.0 / 1131 / 53.3 |
| fine-detail | 256 | 0.31 / 0.13 / 239 / 6.8 | 0.31 / 0.13 / 239 / 6.8 | 1.11 / 0.32 / 26.2 / 1537 / 67.8 |
| fine-detail | 768 | 0.19 / 0.22 / 180 / 5.2 | 0.19 / 0.22 / 180 / 5.2 | 0.37 / 0.33 / 6.1 / 3182 / 139.6 |
| wedges | 128 | 0.11 / 0.09 / 139 / 3.7 | 0.11 / 0.09 / 139 / 3.7 | 0.91 / 0.33 / 58.1 / 410 / 10.3 |
| wedges | 512 | 0.03 / 0.08 / 133 / 3.8 | 0.03 / 0.08 / 133 / 3.8 | 0.56 / 0.33 / 18.3 / 1679 / 42.4 |
| wedges | 512jpg | 0.12 / 0.15 / 382 / 11.5 | 0.12 / 0.15 / 298 / 8.9 | 0.63 / 0.45 / 19.9 / 3251 / 90.8 |
| mascot | 200 | 0.16 / 0.11 / 99 / 3.1 | 0.16 / 0.11 / 99 / 3.1 | 0.87 / 0.34 / 60.4 / 576 / 19.3 |
| mascot | 600 | 0.10 / 0.17 / 125 / 3.7 | 0.10 / 0.17 / 125 / 3.7 | 0.41 / 0.30 / 15.0 / 1472 / 52.0 |
| mascot | 600jpg | 0.26 / 0.18 / 122 / 3.7 | 0.26 / 0.18 / 144 / 4.3 | 0.56 / 0.38 / 59.6 / 7923 / 218.6 |
| gradient-mark | 256 | 0.06 / 0.10 / 34 / 1.1 | 0.58 / 0.05 / 157 / 3.9 | 0.74 / 0.41 / 16.5 / 682 / 15.4 |
| gradient-banner | 384 | 0.14 / 0.09 / 105 / 3.0 | 1.05 / 0.07 / 389 / 10.5 | 1.27 / 0.39 / 4.5 / 530 / 11.6 |
| gradient-banner | 384jpg | 0.24 / 0.05 / 202 / 6.2 | 1.21 / 0.05 / 609 / 16.8 | 1.35 / 0.39 / 26.5 / 1026 / 31.2 |
| radial-glow | 256 | 0.04 / 0.09 / 61 / 2.0 | 0.75 / 0.10 / 266 / 6.7 | 0.69 / 0.38 / 9.3 / 1245 / 25.6 |
| qr-like | 256 | 0.57 / 0.11 / 511 / 6.7 | 0.57 / 0.11 / 511 / 6.7 | 2.43 / 0.27 / 0.0 / 1599 / 35.8 |
| blueprint | 512 | 0.05 / 0.06 / 51 / 1.2 | 0.05 / 0.06 / 51 / 1.2 | 0.77 / 0.39 / 0.0 / 180 / 3.1 |
| signature | 384 | 0.07 / 0.15 / 65 / 1.8 | 0.07 / 0.15 / 65 / 1.8 | 0.33 / 0.56 / 51.3 / 1318 / 33.8 |

Resource checks (`traceImage` worst cases, Node 22): a 1600×1200 photo-like
input takes 2.7 s with about 33 MB heap growth; 1000×1000 pure noise is bounded to
about 1,650 regions and under 1 MB of SVG by the region budget; 4000×3000 inputs
are area-downsampled to the 1.2 MP working cap (uploads above 4 MP are
rejected by the API and downscaled in the browser first; see "Memory" below).

## Against professional expectations

What a professional tool such as Vectorizer.ai is expected to deliver, and where
Vectorla stands on this benchmark:

| Expectation | Status | Evidence |
|---|---|---|
| No gaps or seams between touching shapes | ✅ Met | Shared-boundary planar map, stacked output and same-color underlay strokes. 0 seams on all 80 images (before the underlay: up to 40/10k on emoji; legacy: up to 85/10k). |
| Exact brand colors, no anti-aliasing halo colors | ✅ Met | Palette seeded only from flat pixels, AA-aware labeling, blend-cluster removal. Flat colors reproduce exactly (e.g. `#1e3cc8`). |
| Sub-pixel edge accuracy on anti-aliased art | ✅ Mostly met | 0.07–0.22 px edge error on PNG sources. JPEG sources are 0.18–0.42 px. |
| Crisp corners where the art has corners | ✅ Met for convex/concave corners | Polygon-level corner restoration. An axis-aligned square traces to its exact 4-line outline `m48 48v-32h-32v32z`. |
| Smooth curves with few nodes | ✅ Met | Potrace-grade fitting + curve optimization; 6× fewer segments than legacy. A 33 px-radius circle is 3 cubics. |
| Small text and hairlines preserved | ✅ Mostly met | Real-world corpus: hairlines down to 0.5 px keep 94–104% of their length; small serif text is legible but serifs still break. The detail-color pass recovers 12 px subtitle text in its exact color `#2563eb`; the first engine version dropped it. |
| Clean output from JPEG sources | ✅ Mostly met | Luma-guided chroma restoration, blend-sliver dissolve and edge-aware labeling. JPEG variants are now within 0.9–1.6× the nodes of PNG and 1.0–1.4× the edge error (e.g. flat-logo JPEG: 77 segments, 0.11 px). Heavy low-quality JPEGs are not in the corpus yet. |
| Gradients reproduced as gradients | ✅ Met (Professional) | Linear and radial gradients are reconstructed as SVG gradients: ΔE 0.04–0.23 vs 0.58–1.06 posterized. Quick keeps flat bands for print and cut work. Multi-center, conic and mesh-like shading are not modeled. |
| Corner-to-corner touching shapes (QR, pixel art, checkerboards) | ⚠️ Partial | Corners are sharp; diagonal "pinch" points still produce slight tilts near them (QR ΔE 0.57, down from 1.11). |
| Tangent-continuous curves through 3-color junctions | ⚠️ Partial | Junction positions are least-squares refined; tangents are not yet matched across junctions. |
| Photos / continuous tone | ⚠️ Posterized only | Bounded and clean, but not a photo-realistic vectorization. 6 real photos: ΔE 2.7–3.3 vs the source. |
| Head-to-head against Vectorizer.ai on the same inputs | ❓ Not measured | Needs a Vectorizer.ai API account (paid). It is an owner decision whether to buy credits for benchmarking. |

## History

| Date | Change | Mean ΔE×100 | Mean edge err (px) | Gaps |
|---|---|---:|---:|---:|
| 2026-09-26 | Baseline, legacy Quick (ImageTracer) | 0.94 | 0.41 | yes |
| 2026-09-26 | Baseline, legacy Professional pipeline | 4.37 | 5.95 | yes |
| 2026-09-26 | Vectorla engine v1 (shared boundaries + Potrace-grade fitting) | 0.42 | 0.22 | 0 |
| 2026-09-26 | + detail colors, sRGB blend model, JPEG cleanup | 0.33 | 0.18 | 0 |
| 2026-09-26 | + corner restoration, junction refinement, coverage-correct labeling | 0.26 | 0.16–0.17 | 0 |
| 2026-09-28 | + gradient corpus cases (25 variants); Professional gradient reconstruction | 0.22 (Pro) / 0.34 (Quick) | 0.15–0.16 | 0 |
| 2026-09-28 | + JPEG chroma restoration, blend-sliver dissolve, edge labeling next to thin strokes | **0.18** (Pro) / 0.31 (Quick) | **0.12** | 0 |
| 2026-10-03 | Real-world corpus (55 images); gradient validation, seam underlay, thin-feature labeling, blend-tint filter, memory limits | 0.17 (Pro) / 0.29 (Quick) core; 0.68 / 0.74 real-world | 0.12 / 0.13 | 0 |
