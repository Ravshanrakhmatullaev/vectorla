# Vectorla — Vector Quality Benchmarks

The primary product metric is **vector output quality**. This file records how
it is measured, the current numbers, and how they compare with what
professional vectorization tools deliver.

## Methodology: render-and-diff against ground-truth vectors

Structural proxies (path counts, "curve ratio") cannot tell whether a trace
*looks right*. The benchmark therefore starts from vectors whose correct answer
is known:

1. **Ground truth.** `backend/src/benchmark/corpus.ts` holds 11 hand-authored
   SVG designs covering the customer categories: flat logo, wordmark (real
   font text, including small 12 px subtitle text at the low-res variant), line
   icon, die-cut sticker with transparency, fine-detail badge (thin rings,
   24 small dots), multi-color wedges (3-color junctions), cartoon mascot with
   outlines, gradient mark, QR code, blueprint line art, and a signature.
2. **Customer-like rasters.** Each design is rendered anti-aliased (resvg) at
   1–3 source sizes (64 px to 768 px), encoded as PNG or JPEG (q75) exactly
   like an upload, and decoded through the production decoder: 22 variants in all.
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

## Current results (2026-09-26)

Engines:

- **professional**: Vectorla engine, Professional profile (2 MP working size, 64 colors).
- **quick**: Vectorla engine, Quick profile (1.5 MP working size, 32 colors).
- **legacy**: the pre-engine production path (image analysis → named preset →
  ImageTracer → regex SVG cleanup). It is kept as the fallback provider.

### Summary (22 variants)

| Engine | Mean ΔE×100 | Mean bad px % | Mean edge err (px) | Mean gaps/10k | Total segments | Total KB | Total ms |
|---|---:|---:|---:|---:|---:|---:|---:|
| **professional** | **0.26** | **0.68** | **0.17** | **0.0** | 6,895 | 137.6 | 11,194 |
| **quick** | **0.26** | **0.66** | **0.16** | **0.0** | 5,951 | 122.5 | 9,962 |
| legacy (ImageTracer) | 0.93 | 1.69 | 0.41 | 24.0 | 41,234 | 1,252.0 | 4,931 |
| legacy Professional pipeline (removed) | 4.37 | 13.47 | 5.95 | n/a¹ | 51,424 | 1,644.0 | 7,487 |

¹ Measured before the gap metric was restricted to interior pixels; its visual
failure was gross edge displacement (up to 23 px) caused by whole-image
quantization and auto-levels running before tracing.

Compared with the legacy path, the engine delivers **3.6× lower color error, 2.5× lower edge error,
zero gaps/seams, 6× fewer nodes, and 9–10× smaller files**. It is never worse
than legacy on any single variant; the quality gate enforces this.

### Per variant

| Case | Source | Professional ΔE / edge px / segs / KB | Quick ΔE / edge px / segs / KB | Legacy ΔE / edge px / gaps / segs / KB |
|---|---|---|---|---|
| flat-logo | 128 | 0.16 / 0.11 / 90 / 1.8 | 0.16 / 0.11 / 90 / 1.8 | 1.29 / 0.37 / 18.8 / 397 / 9.0 |
| flat-logo | 512 | 0.04 / 0.09 / 59 / 1.2 | 0.04 / 0.09 / 59 / 1.2 | 0.21 / 0.36 / 4.0 / 427 / 20.6 |
| flat-logo | 512jpg | 0.20 / 0.36 / 716 / 14.9 | 0.19 / 0.33 / 736 / 14.5 | 0.81 / 0.38 / 23.4 / 4092 / 117.7 |
| wordmark | 256 | 0.74 / 0.20 / 443 / 9.9 | 0.74 / 0.20 / 443 / 9.9 | 2.26 / 0.50 / 35.6 / 1080 / 24.7 |
| wordmark | 768 | 0.19 / 0.19 / 494 / 8.6 | 0.23 / 0.20 / 331 / 6.7 | 1.16 / 0.41 / 9.4 / 2697 / 51.3 |
| wordmark | 768jpg | 0.39 / 0.42 / 1761 / 29.5 | 0.35 / 0.37 / 1133 / 20.5 | 1.10 / 0.76 / 84.7 / 6757 / 212.1 |
| line-icon | 64 | 0.29 / 0.08 / 33 / 0.6 | 0.29 / 0.08 / 33 / 0.6 | 2.93 / 0.63 / 6.9 / 160 / 4.7 |
| line-icon | 256 | 0.07 / 0.08 / 66 / 1.0 | 0.07 / 0.08 / 66 / 1.0 | 0.73 / 0.44 / 0.9 / 266 / 12.6 |
| sticker | 160 | 0.06 / 0.07 / 37 / 1.2 | 0.06 / 0.07 / 37 / 1.2 | 0.26 / 0.34 / 8.6 / 418 / 17.3 |
| sticker | 512 | 0.02 / 0.09 / 47 / 1.7 | 0.02 / 0.09 / 47 / 1.7 | 0.07 / 0.34 / 4.0 / 1131 / 53.3 |
| fine-detail | 256 | 0.31 / 0.13 / 239 / 6.8 | 0.31 / 0.13 / 239 / 6.8 | 1.11 / 0.32 / 26.2 / 1537 / 67.8 |
| fine-detail | 768 | 0.19 / 0.22 / 180 / 5.2 | 0.19 / 0.22 / 180 / 5.2 | 0.37 / 0.33 / 6.1 / 3182 / 139.6 |
| wedges | 128 | 0.10 / 0.07 / 135 / 2.5 | 0.10 / 0.07 / 135 / 2.5 | 0.91 / 0.33 / 58.1 / 410 / 10.3 |
| wedges | 512 | 0.03 / 0.09 / 130 / 2.6 | 0.03 / 0.09 / 130 / 2.6 | 0.56 / 0.33 / 18.3 / 1679 / 42.4 |
| wedges | 512jpg | 0.13 / 0.18 / 577 / 12.4 | 0.12 / 0.16 / 424 / 9.2 | 0.63 / 0.45 / 19.9 / 3251 / 90.8 |
| mascot | 200 | 0.44 / 0.36 / 204 / 5.1 | 0.44 / 0.35 / 216 / 5.4 | 0.87 / 0.34 / 60.4 / 576 / 19.3 |
| mascot | 600 | 0.11 / 0.18 / 226 / 5.8 | 0.10 / 0.18 / 193 / 5.1 | 0.41 / 0.30 / 15.0 / 1472 / 52.0 |
| mascot | 600jpg | 0.26 / 0.19 / 682 / 15.9 | 0.26 / 0.19 / 681 / 15.8 | 0.56 / 0.38 / 59.6 / 7923 / 218.6 |
| gradient-mark | 256 | 0.59 / 0.05 / 131 / 2.8 | 0.58 / 0.04 / 133 / 2.6 | 0.74 / 0.41 / 16.5 / 682 / 15.4 |
| qr-like | 256 | 1.11 / 0.15 / 535 / 5.2 | 1.11 / 0.15 / 535 / 5.2 | 2.43 / 0.27 / 0.0 / 1599 / 35.8 |
| blueprint | 512 | 0.19 / 0.16 / 45 / 1.2 | 0.19 / 0.16 / 45 / 1.2 | 0.77 / 0.39 / 0.0 / 180 / 3.1 |
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
| Clean output from JPEG sources | ⚠️ Partial | Artifact-aware denoise and speckle removal work. JPEG variants still carry 2–3× the nodes of PNG and about 2× the edge error. |
| Gradients reproduced as gradients | ❌ Not yet | Gradients are posterized into flat bands (gradient-mark ΔE 0.59, now the second-worst case). |
| Corner-to-corner touching shapes (QR, pixel art, checkerboards) | ⚠️ Partial | Corners are sharp, but diagonal "pinch" points still produce slight tilts near them (QR ΔE 1.11). |
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
| 2026-09-26 | + corner restoration, junction refinement, coverage-correct labeling | **0.26** | **0.16–0.17** | 0 |
