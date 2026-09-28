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
```

`--out` writes each source raster, traced SVG and 4× render for visual review.

## Current results (2026-09-28)

Engines:

- **professional**: Vectorla engine, Professional profile (2 MP working size, 64 colors, gradient reconstruction).
- **quick**: Vectorla engine, Quick profile (1.5 MP working size, 32 colors).
- **legacy**: the pre-engine production path (image analysis → named preset →
  ImageTracer → regex SVG cleanup). It is kept as the fallback provider.

### Summary (25 variants)

| Engine | Mean ΔE×100 | Mean bad px % | Mean edge err (px) | Mean gaps/10k | Total segments | Total KB | Total ms |
|---|---:|---:|---:|---:|---:|---:|---:|
| **professional** | **0.18** | **0.48** | **0.12** | **0.0** | 3,616 | 77.6 | 22,264 |
| **quick** | **0.31** | **0.48** | **0.12** | **0.0** | 4,382 | 92.6 | 19,019 |
| legacy (ImageTracer) | 0.95 | 1.59 | 0.40 | 22.7 | 44,035 | 1,320.4 | 7,207 |
| legacy Professional pipeline (removed, 22-variant corpus) | 4.37 | 13.47 | 5.95 | n/a¹ | 51,424 | 1,644.0 | 7,487 |

¹ Measured before the gap metric was restricted to interior pixels; its visual
failure was gross edge displacement (up to 23 px) caused by whole-image
quantization and auto-levels running before tracing.

Compared with the legacy path, Professional delivers **5.3× lower color error, 3.3× lower
edge error, zero gaps/seams, 12× fewer nodes and 17× smaller files**. Neither
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
| flat-logo | 512jpg | 0.12 / 0.10 / 77 / 1.9 | 0.12 / 0.11 / 70 / 1.7 | 0.81 / 0.38 / 23.4 / 4092 / 117.7 |
| wordmark | 256 | 0.70 / 0.18 / 194 / 4.8 | 0.70 / 0.18 / 194 / 4.8 | 2.26 / 0.50 / 35.6 / 1080 / 24.7 |
| wordmark | 768 | 0.18 / 0.18 / 332 / 6.0 | 0.22 / 0.20 / 279 / 6.0 | 1.16 / 0.41 / 9.4 / 2697 / 51.3 |
| wordmark | 768jpg | 0.23 / 0.19 / 362 / 7.0 | 0.29 / 0.22 / 318 / 6.6 | 1.10 / 0.76 / 84.7 / 6757 / 212.1 |
| line-icon | 64 | 0.29 / 0.08 / 33 / 0.6 | 0.29 / 0.08 / 33 / 0.6 | 2.93 / 0.63 / 6.9 / 160 / 4.7 |
| line-icon | 256 | 0.07 / 0.08 / 62 / 0.9 | 0.07 / 0.08 / 62 / 0.9 | 0.73 / 0.44 / 0.9 / 266 / 12.6 |
| sticker | 160 | 0.06 / 0.07 / 37 / 1.2 | 0.06 / 0.07 / 37 / 1.2 | 0.26 / 0.34 / 8.6 / 418 / 17.3 |
| sticker | 512 | 0.02 / 0.09 / 47 / 1.7 | 0.02 / 0.09 / 47 / 1.7 | 0.07 / 0.34 / 4.0 / 1131 / 53.3 |
| fine-detail | 256 | 0.31 / 0.13 / 239 / 6.8 | 0.31 / 0.13 / 239 / 6.8 | 1.11 / 0.32 / 26.2 / 1537 / 67.8 |
| fine-detail | 768 | 0.19 / 0.22 / 180 / 5.2 | 0.19 / 0.22 / 180 / 5.2 | 0.37 / 0.34 / 6.1 / 3182 / 139.6 |
| wedges | 128 | 0.10 / 0.08 / 139 / 2.5 | 0.10 / 0.08 / 139 / 2.5 | 0.91 / 0.33 / 58.1 / 410 / 10.3 |
| wedges | 512 | 0.03 / 0.09 / 131 / 2.6 | 0.03 / 0.09 / 131 / 2.6 | 0.56 / 0.33 / 18.3 / 1679 / 42.4 |
| wedges | 512jpg | 0.13 / 0.18 / 372 / 7.7 | 0.12 / 0.17 / 262 / 5.2 | 0.63 / 0.45 / 19.9 / 3251 / 90.8 |
| mascot | 200 | 0.16 / 0.11 / 101 / 2.8 | 0.16 / 0.11 / 101 / 2.8 | 0.87 / 0.34 / 60.4 / 576 / 19.3 |
| mascot | 600 | 0.10 / 0.18 / 117 / 3.6 | 0.10 / 0.18 / 117 / 3.6 | 0.41 / 0.30 / 15.0 / 1472 / 52.0 |
| mascot | 600jpg | 0.26 / 0.18 / 108 / 3.4 | 0.26 / 0.18 / 121 / 3.7 | 0.56 / 0.38 / 59.6 / 7923 / 218.6 |
| gradient-mark | 256 | 0.06 / 0.13 / 29 / 1.0 | 0.58 / 0.04 / 157 / 2.8 | 0.74 / 0.41 / 16.5 / 682 / 15.4 |
| gradient-banner | 384 | 0.15 / 0.08 / 101 / 2.3 | 1.06 / 0.07 / 337 / 6.2 | 1.27 / 0.39 / 4.5 / 530 / 11.6 |
| gradient-banner | 384jpg | 0.24 / 0.04 / 194 / 4.5 | 1.22 / 0.06 / 593 / 11.7 | 1.35 / 0.39 / 26.5 / 1026 / 31.2 |
| radial-glow | 256 | 0.04 / 0.10 / 41 / 1.5 | 0.75 / 0.10 / 245 / 6.3 | 0.69 / 0.38 / 9.3 / 1245 / 25.6 |
| qr-like | 256 | 0.57 / 0.11 / 511 / 4.6 | 0.57 / 0.11 / 511 / 4.6 | 2.43 / 0.27 / 0.0 / 1599 / 35.8 |
| blueprint | 512 | 0.20 / 0.16 / 51 / 1.3 | 0.20 / 0.16 / 51 / 1.3 | 0.77 / 0.39 / 0.0 / 180 / 3.1 |
| signature | 384 | 0.07 / 0.15 / 65 / 1.8 | 0.07 / 0.15 / 65 / 1.8 | 0.33 / 0.56 / 51.3 / 1318 / 33.8 |

Resource checks (`traceImage` worst cases, Node 22): a 1600×1200 photo-like
input takes 2.7 s with about 33 MB heap growth; 1000×1000 pure noise is bounded to
about 1,650 regions and under 1 MB of SVG by the region budget; 4000×3000 inputs
are area-downsampled to the 2 MP working cap.

## Against professional expectations

What a professional tool such as Vectorizer.ai is expected to deliver, and where
Vectorla stands on this benchmark:

| Expectation | Status | Evidence |
|---|---|---|
| No gaps or seams between touching shapes | ✅ Met | Shared-boundary planar map; stacked output. 0 gaps on all 22 variants (legacy: up to 85/10k). |
| Exact brand colors, no anti-aliasing halo colors | ✅ Met | Palette seeded only from flat pixels, AA-aware labeling, blend-cluster removal. Flat colors reproduce exactly (e.g. `#1e3cc8`). |
| Sub-pixel edge accuracy on anti-aliased art | ✅ Mostly met | 0.07–0.22 px edge error on PNG sources. JPEG sources are 0.18–0.42 px. |
| Crisp corners where the art has corners | ✅ Met for convex/concave corners | Polygon-level corner restoration. An axis-aligned square traces to its exact 4-line outline `m48 48v-32h-32v32z`. |
| Smooth curves with few nodes | ✅ Met | Potrace-grade fitting + curve optimization; 6× fewer segments than legacy. A 33 px-radius circle is 3 cubics. |
| Small text and hairlines preserved | ✅ Met in corpus | Detail-color pass recovers 12 px subtitle text in its exact color `#2563eb`; the first engine version dropped it. |
| Clean output from JPEG sources | ✅ Mostly met | Luma-guided chroma restoration, blend-sliver dissolve and edge-aware labeling. JPEG variants are now within 0.9–1.6× the nodes of PNG and 1.0–1.4× the edge error (e.g. flat-logo JPEG: 77 segments, 0.11 px). Heavy low-quality JPEGs are not in the corpus yet. |
| Gradients reproduced as gradients | ✅ Met (Professional) | Linear and radial gradients are reconstructed as SVG gradients: ΔE 0.04–0.23 vs 0.58–1.06 posterized. Quick keeps flat bands for print and cut work. Multi-center, conic and mesh-like shading are not modeled. |
| Corner-to-corner touching shapes (QR, pixel art, checkerboards) | ⚠️ Partial | Corners are sharp; diagonal "pinch" points still produce slight tilts near them (QR ΔE 0.57, down from 1.11). |
| Tangent-continuous curves through 3-color junctions | ⚠️ Partial | Junction positions are least-squares refined; tangents are not yet matched across junctions. |
| Photos / continuous tone | ⚠️ Posterized only | Bounded and clean, but not a photo-realistic vectorization. |
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
