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
npm run bench -- --corpus=all --engines=quick,professional --memory --compare=before.json  # all 80 images
npm run bench -- --corpus=emblem --engines=quick,professional --compare  # 28 emblem rasters vs baseline-emblem.json
npx tsx src/benchmark/emblemGate.smoke-test.ts     # emblem regression gate (also part of npm test)
npx tsx src/benchmark/emblemDiagnostics.ts --variants=600,1200  # what each engine stage did, per emblem
```

`--out` writes each source raster, traced SVG and 4× render for visual review.

## High-resolution engine (2026-10-03, branch `claude/bold-newton-y6wsui`)

Goal: trace at higher resolution without approaching a Worker's 128 MB, keep
isolated hairlines and thin signatures, and preserve Quick/Professional
quality (gradients, sharp corners, seamless neighbouring shapes).

### Approach: buffer diet + streaming, not tiles

Three ways to fit a 4 MP trace in memory were compared:

| Approach | Memory | Output | Verdict |
|---|---|---|---|
| **Tiles** (trace overlapping tiles, stitch) | bounded by tile size | Regions and palette differ per tile; shared boundaries must be re-matched across tiles, or seams and doubled shapes appear; gradients and region budgets become per-tile | rejected: the engine's planar map relies on one global labeling, which is what makes neighbouring shapes seamless |
| **Streaming filters** (row-rolling denoise/blur/chroma) | removes whole-image float/temp planes | bit-identical | kept |
| **Per-pixel buffer diet** | ~35 → ~11 B per working pixel at the peak | bit-identical | kept |

What changed (each step verified byte-identical on all 160 traces, 80 images
× 2 modes, against a reference copy of the previous engine):

- Gaussian blur, JPEG chroma restore and bilateral denoise keep a ring of
  2r+1 rows instead of full-size temporary planes.
- OKLab is computed on demand through a 64K-entry direct-mapped cache
  (`OklabSource`), rounded through float32 exactly like the old stored array
  (12 B per pixel saved).
- Labels are `Int16Array` (palettes < 16,000 colors), pair arrays 8-bit,
  the coverage plane is recomputed where it is needed.
- Connected components write ids in place over their union-find parent
  array; merge / sliver passes work in place and share one scratch buffer.
- Image buffers are recycled between denoise stages; the decoded upload is
  handed to the engine (`traceOwnedImage`) and dropped as soon as it has been
  reduced, so the full decode is not held during tracing.
- Downscaling uses whole factors (exact k×k blocks, `downscaleBox`) instead
  of fractional area resampling, which smeared anti-aliased edges unevenly.
  At the same budget, 2× to 1.0 MP beats fractional 1.2 MP on every case
  tested (edge error logo 0.42 vs 0.61 px, thin-lines 0.47 vs 0.72, hex
  0.38 vs 0.53 with 514 vs 1,570 segments).

### Memory (measured in the real Workers runtime)

**Method.** A bare workerd config (the runtime inside `wrangler dev` and
Cloudflare) runs a local harness worker with V8's `--expose-gc`. The engine
calls `checkpoint()` inside every heavy stage (engine/memoryCheckpoint.ts;
a no-op in production). The harness hook runs `gc()` and then `debugger`.
While the isolate is paused, an inspector client reads
`Runtime.getHeapUsage` (JS heap + ArrayBuffer backing stores). Peak minus
the starting value is the trace's exact live peak, including the decode.
Without forced GC the same readings give an upper bound that includes
uncollected garbage. Node's `memory.smoke-test.ts` repeats this in CI with
budgets. `wrangler dev` with `MEMORY_CHECKPOINTS=1` (development only)
enables the same pauses in the real app.

**Live peak, 4 MP upload traced at its full resolution** (before → after
the diet): photo 84 → 61 MB, logo 70 → 46–47 MB.

**Production profiles, final engine (workerd):**

| Upload | Mode | Working size | Live peak | No-GC peak | Trace time |
|---|---|---|---:|---:|---:|
| 4 MP JPEG photo | Quick | 1224×816 (photo cap) | 19.3 MB | 43.8 MB | 3.8 s |
| 4 MP JPEG photo | Professional | 1224×816 | 19.3 MB | 49.3 MB | 4.4 s |
| 4 MP PNG logo | Quick | 2000×2000 (full) | 47.1 MB¹ | 62.4 MB | 1.9–2.2 s |
| 4 MP PNG logo | Professional | 2000×2000 (full) | 47.1 MB | 62.7 MB | 2.2–2.3 s |
| 600 px PNG logo | Quick | 1200×1200 (2× upsampled) | 17.9 MB | 28.0 MB | 1.2 s |
| 600 px PNG logo | Professional | 1200×1200 (2× upsampled) | 17.9 MB | 29.4 MB | 1.4 s |

¹ Four fresh-isolate runs gave 47.1 MB three times and 54.7 MB once. The
GC before that checkpoint had not yet released one 8 MB buffer.

On main the same 4 MP logo was traced at 1.2 MP.

**Correction (launch audit): decoder WebAssembly memory is not in these
numbers.** `Runtime.getHeapUsage` does not count WebAssembly memories, so
the table above covers the JS heap and ArrayBuffers only. Measured
separately, by reading each decoder's memory size after a decode:

| Decode | Decoder WASM memory |
|---|---:|
| 4 MP PNG logo (0.2 MB file) | 36–39 MB |
| 15.5 MB 16-bit 4 MP PNG | 51 MB |
| 0.7 MB 4 MP photo JPEG | 19 MB |
| 6.2 MB progressive 4:4:4 4 MP JPEG | 51 MB |
| the same JPEG padded to 30 MB with comment segments | 104 MB |

Two problems followed, both fixed in the audit:

- Decoder instances outlived their decodes:
  - @jsquash/png keeps one instance per isolate, so after one 4 MP PNG its
    ~39 MB stayed allocated beside every later trace (worst case
    ~63 + 39 ≈ 102 MB).
  - The JPEG/WebP "re-initialize after decode" pattern still left a fresh
    instance holding ~32 MB.
  - Removing the PNG glue import also removed its module-scope `ImageData`
    polyfill. The JPEG glue then defined one from inside its first instance's
    closure, which pinned that instance (19 MB) for the life of the isolate.

  Now every decode creates its own instance and drops it: PNG through a
  per-call copy of the glue (`providers/pngDecoder.ts`), JPEG and WebP
  through jsquash's `initEmscriptenModule`. The polyfill is defined at module
  scope in `imageDecoder.ts`. Three 4 MP PNG decodes retain 0.0 MB, against
  33 MB before (`memory.smoke-test.ts` checks this). In workerd, 12
  back-to-back conversions keep the pre-conversion heap at 3–5 MB.
- A padded JPEG pushed the decoder past 100 MB. Metadata segments are now
  stripped before decoding (`providers/jpegSegments.ts`), and JPEG/WebP
  files larger than 2 MB + 3 bytes per pixel (13.4 MB at 4 MP) are rejected
  with 413.

What remains is transient during a decode: file + decoder memory + the 16 MB
RGBA result, e.g. 6 + 51 + 16 ≈ 73 MB for a high-entropy 4 MP JPEG. It is
released before the trace's own peak. A 25 MB 16-bit PNG, which only paid
plans may upload, is estimated at ~110 MB at that moment in the queue
consumer. See ROADMAP P6 on the plan size limit.

**Why photos stay at 1.2 MP.** A 4 MP photo at full resolution measured
61 MB live but up to ~129 MB without forced GC in Professional (85 MB
Quick), and 11–15 s. Posterized photos gain nothing visible from more
pixels. Photos are recognised by a sampled flat fraction: the share of
pixels whose right and lower neighbours differ by ≤ 3 per channel. Art
measures 0.72–0.99 (still 0.89–0.97 as q40–q90 JPEG at 4 MP), photos and
scans 0.30–0.66. Below 0.70 the 1.2 MP photo cap applies (whole-factor 2×
for a 4 MP photo).

### Accuracy at 4 MP (main vs this branch)

Corpus art rendered at ~4 MP and ~2.5 MP (what the browser uploads after
its downscale), traced by main's engine (1.2 MP, fractional) and this
branch, and scored at the upload's own resolution:

| Case | Upload | main ΔE×100 | main edge px | main KB | main s | branch ΔE×100 | branch edge px | branch KB | branch s |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|
| logo-complex | 2000² | 0.17 | 0.61 | 17.1 | 0.8 | **0.06** | **0.24** | **12.5** | 2.0 |
| typo-serif | 2828×1414 | 0.58 | 0.75 | 72.9 | 1.0 | **0.19** | **0.38** | **65.9** | 1.7 |
| ornament | 2000² | 0.21 | 0.59 | 17.3 | 0.7 | **0.05** | **0.15** | **11.9** | 1.4 |
| thin-lines | 2000² | 0.40 | 0.71 | 7.0 | 0.7 | **0.13** | **0.34** | **3.9** | 1.5 |
| hex-mosaic | 2000² | 0.16 | 0.53 | 28.8 | 0.6 | **0.06** | **0.22** | **12.6** | 1.5 |
| emoji-unicorn | 2000² | 0.07 | 0.48 | 12.1 | 0.5 | **0.03** | **0.11** | **9.1** | 1.1 |
| emoji3d-globe | 2000² | 0.84 | 0.54 | 72.8 | 0.7 | **0.81** | **0.11** | 81.1 | 1.5 |
| icon-settings | 2000² | 0.15 | 0.63 | 5.3 | 0.4 | **0.05** | **0.34** | **3.8** | 0.9 |

Quick shown; Professional is within ±0.01 except emoji3d-globe (0.73 →
0.69, 70.8 → 75.6 KB). At 2.5 MP the gains are the same (logo edge 0.63 →
0.26 px). Edge error falls 2–4× and SVGs are 10–56% smaller on
everything except the 3D globe (+1–11%), because full-resolution edges need
fewer corrective nodes. Tracing takes 1.5–2.5× longer (≤ 2.3 s).

### Hairlines and thin signatures (upsampler)

Small images are upsampled 2–4× bilinearly and blurred (σ = 0.45 × factor)
to remove interpolation ripple. That blur averaged an isolated ≤ 1 px line
into the background, so it vanished or broke into dashes (edge-length ratio
0.00–0.14 on a 256 px render of a hairline drawing).

| Option | Hairline set ΔE (sum) | Edge-length ratio | 80 images |
|---|---:|---|---|
| bilinear + blur (main) | 1.718 | 0.00–0.14 | baseline |
| bilinear, no blur | 1.281 | 0.23–0.93 | not run (hairlines still break) |
| Catmull-Rom bicubic, no blur | 0.667 | 0.82–0.96 | +22% segments, seams (gaps 0.16/10k) |
| bicubic, blur 0.25 | 0.734 | – | +14% segments, gaps 0.53/10k |
| **ridge-preserving (kept)** | **0.685** | **0.82–0.96** | ΔE 0.578 → 0.576 Quick, 0.516 → 0.514 Pro; SVG +0.4%; no gaps |

**Ridge-preserving upsampling** (`ridgeMask` / `restoreRidges`): the
upscale stays bilinear + blur, and only pixels on an isolated one-pixel
ridge are overwritten with sharp Catmull-Rom samples. A ridge pixel is
darker or lighter than both neighbours along some direction by ≥ 32 in a
channel, and those two neighbours match each other (a line on one
background, not an edge between two fills). Each rule below was added
after an A/B regression:

- Diagonal ridges with two same-colored axis neighbours are checkerboard
  corners, and diagonal ridges with a much stronger neighbour along the line
  are anti-aliased corners of solid blocks. QR codes regressed 0.58 → 0.65
  without this.
- Speckles are dropped: runs of 1–2 ridge pixels, or runs under 4 that
  contain a lone dot (an extremum in all four directions). Runs are linked
  across one-pixel gaps. Without this rule, salt-and-pepper noise became
  shapes.
- The mask is dilated by 2 px. A shallow line (~8°) crosses between pixel
  rows every few pixels, and there its coverage is split so no single pixel
  is a ridge. With 1 px dilation those spots were left blurred and the line
  came out dashed.
- Photos (flat fraction < 0.70, measured before denoising) skip it entirely.
- Two-pixel-wide strokes are excluded. They survive the blur anyway, and
  including them opened gaps on 48 px icons (2.8/10k on icon-heart).

Result on all 80 images: no image is worse by ≥ 0.02 ΔE, no seams, and
wordmark@256 0.59 → 0.51, typo-serif@512 0.85 → 0.79, thin-lines@256 0.49 →
0.45 (Quick), ornament@160 0.48 → 0.45. The cost is more segments on those images
(+7–50%).

### 80-image benchmark (main @65fbb9b → this branch)

| Metric | Quick | Professional |
|---|---:|---:|
| Mean ΔE×100 | 0.58 → 0.58 | 0.52 → 0.51 |
| Mean edge error (px) | 0.13 → 0.13 | 0.13 → 0.13 |
| Seams / 10k | 0.0 → 0.0 | 0.0 → 0.0 |
| Total segments | 195,289 → 196,179 | 216,073 → 217,016 |
| Total SVG size | 4,879 → 4,897 KB | 5,439 → 5,458 KB |
| Failed traces | 0 | 0 |

The benchmark images are ≤ 1 MP, so they exercise the upsampler, not the
4 MP path (see "Accuracy at 4 MP"). The comparison flags 9 variants, all
for segment growth above 15%, with ΔE and edge error no worse than +0.01:
wordmark@256, fine-detail@256, logo-complex@512 (Quick), thin-lines@256
and ornament@160.

### Regression tests

- `engine/memory.smoke-test.ts`: exact live peak with forced GC at every
  checkpoint. A 4 MP artwork at full resolution must stay ≤ 46 MB (measured
  39.5) and a 4 MP photo ≤ 23 MB (19.1). It also asserts the working sizes.
- `engine/highResolution.smoke-test.ts`: isolated 0.5–1 px diagonals, a
  signature curve and a circle must keep edge-length ratio ≥ 0.7 in both
  modes. 4 MP logo-complex and ornament must be traced at full resolution
  with edge error ≤ 0.4 px (measured 0.24 / 0.15).
- `pipeline/ProfessionalTracePipeline.smoke-test.ts`: tracing must not
  modify the caller's pixels. A bug found here: `runTracePipeline` handed a
  caller-owned image to the buffer-recycling path.

### Limitations

- Photos are still traced at 1.2 MP (by design, see above).
- Hairline restoration applies to upsampled (small) images. At ≥ 1 MP,
  full-resolution tracing plus the existing thin-feature pass keep lines.
- A signature traced from a small source keeps its stroke, but its outline
  is built from more pieces (9–31 paths for a single curve).
- Memory was measured in workerd locally. Cloudflare's runtime was measured
  later on staging (2026-10-09, see "On Cloudflare" under "Upload size").
- 4 MP artwork takes up to ~2.3 s of CPU, 1.5–2.5× the 1.2 MP time.

## Optimization round (2026-10-03, branch `claude/bold-newton-y6wsui`)

Goals: smaller SVGs, better small text and thin lines, Quick keeping pale
colors on JPEGs, lower memory, and an answer on whether 4 MP is enough. Every
change below was A/B-tested on all 80 images (core + real-world) in both modes.
A change was kept only if no image got worse by more than ±0.01 ΔE.

### Before and after (80 images)

| Metric | Quick before | Quick after | Professional before | Professional after |
|---|---:|---:|---:|---:|
| Mean ΔE×100 | 0.60 | **0.58** | 0.52 | 0.52 |
| Mean bad px % | 1.08 | **1.07** | 1.06 | 1.06 |
| Mean edge error (px)¹ | 0.13 | 0.13 | 0.13 | 0.13 |
| Mean seams / 10k¹ | 0.0 | 0.0 | 0.0 | 0.0 |
| Total segments | 192,589 | 195,289 (+1.4%) | 214,501 | 216,073 (+0.7%) |
| Total SVG size | 5,182 KB | **4,879 KB (−5.9%)** | 5,822 KB | **5,439 KB (−6.6%)** |
| Total trace time (Node, 1 core) | 63.9 s | **62.4 s** | 75.6 s | **72.2 s** |
| Failed traces | 0 | 0 | 0 | 0 |

¹ Vector-reference images only.

Largest per-image changes: logo-complex@512 JPEG q40 (Quick) 1.60 → 0.38;
emoji-fox@256 blurred (Quick) 0.50 → 0.10; thin-lines@256 (Quick) 0.70 → 0.49;
typo-serif@512 0.92 → 0.85. Every image whose segment count rose by more than
15% also improved or held its ΔE (thin strokes kept, the pale fill kept).

### Kept

1. **Palette separation** (`paletteSeparation`, engine/palette.ts). Two
   large color clusters closer than the merge distance are kept apart when
   the gap between them is more than 3× their combined noise spread. A pale
   tint next to white (#e9f0ff vs #fff, ~0.05 OKLab apart) is two inks, while
   one noisy ink is not. This was the cause of Quick tinting the whole
   background of the q40 logo. Professional's finer merge distance already
   avoided it.
2. **Ridge promotion for thin strokes** (preserveThinCoverage). Where a
   shallow diagonal crosses between pixel rows, its ink is split over two
   rows, no pixel ranks among its window's densest, and the stroke broke into
   dashes. A pixel is now also kept when it is a coverage ridge across the
   stroke and three conditions hold:
   - the ridge continues along the stroke (a corner's apex does not);
   - it has enough ink nearby;
   - the stroke contrasts with what it is drawn on by at least 0.15 OKLab.
     Without this, posterized shading in 3D-style art gained 25% more nodes for
     nothing.
3. **Size-relative coordinate precision.** The coordinate step is at most
   1/5000 of the image's longer side: 3 decimals below 50 px, 2 below 500 px,
   1 below 5000 px. The old rule used 2 decimals up to 600 px, so 512–600 px
   images and photos carried 0.01 px coordinates. This saves ~7% with no
   measurable change (mean ΔE identical, visually identical text at 4×).
4. **Memory** (see below). Single decode, early downscale, decoder reset,
   scoped per-pixel buffers. Output is byte-identical (checked on all 160
   traces).
5. **Denoise fast path.** Interior pixels skip bounds checks. The output is
   bit-identical (160/160) and about 10% faster.

### Tried and rejected

- **Underlay only where a seam would be visible.** For each shared edge, the
  shape painted underneath was found and the worst-case seam color
  (¼ underlying + ¼ earlier + ½ later shape) was compared with a clean edge.
  It saved only 0.3%, because almost every sibling edge sits over a parent of
  a different color. It also let a few faint seams through on photos. Removed.
- **Whole-pixel underlay coordinates.** Saved 4–8% but re-opened visible
  seams (24–47 changed pixels per 10k, ΔE up to 1.0).
- **Recording blends for hairlines on a plain background.** This made an
  isolated hairline visible to the thin-feature pass. It helped text
  (typo-serif@512 0.85 → 0.73) and wordmarks but hurt line art
  (thin-lines@512 0.27 → 0.44), QR codes and noisy flat art (salt-and-pepper
  specks became shapes). Rejected under the no-category-regresses rule.

### Memory

**Method.** The isolate's live memory decides whether a Worker survives, not
process RSS. I measured it three ways:

1. Exact live memory in Node, on the production decode + trace path. Forced
   GC runs after every pipeline stage, with synchronous ArrayBuffer sweeping
   (`node --expose-gc --no-concurrent-array-buffer-sweeping`). It counts JS
   heap plus ArrayBuffers and reports the peak over stages.
2. The real Workers runtime: `wrangler dev` runs workerd. The V8 inspector
   (`--inspector-port`) is sampled with `Runtime.getHeapUsage` every 20 ms
   during real uploads through the API. The trace is synchronous, so samples
   only land between async steps. These are lower bounds that include
   uncollected garbage, and they are noisy.
3. The benchmark's `--memory` column: child-process maxRSS growth of a
   trace-only run (no decode). Across all 160 traces its mean change is
   −0.05 MB with ±20 MB per-image noise. It does not show the decoder
   savings.

**Exact live peak (method 1)**, main @14a2354 → this branch:

| Upload | Quick | Professional |
|---|---|---|
| 4 MP JPEG photo | 68.4 → **42.7 MB** (−38%) | 46.2 → **35.6 MB** (−23%) |
| 4 MP PNG logo | 48.2 → **32.3 MB** (−33%) | 48.3 → **32.4 MB** (−33%) |
| 600 px PNG logo (upsampled to 1.44 / 1.5 MP) | 40.1 → 39.5 MB | 40.2 → 39.6 MB |

**workerd isolate (method 2, sampled lower bound, heap + ArrayBuffers)**,
before → after: 4 MP photo Quick 102 → 81 MB, Professional 116 → 91 MB.
4 MP logo and 600 px logo: 36–48 MB.

What changed:

- **One decode instead of two.** Quick decoded every upload twice: once for
  image analysis, once for the trace. It now decodes once, analyses that
  image, and traces it (`decodeForTrace`, `ImageAnalysisService.analyzeDecoded`).
- **Early downscale.** The full-resolution image is reduced to the working
  size right after decoding and released before tracing (16 MB for 4 MP).
  traceImage's `sourceSize` keeps the SVG at the upload's dimensions.
- **Decoder reset.** A jsquash decoder keeps its last WebAssembly instance,
  whose memory has grown to fit the largest image decoded and never shrinks
  (~15 MB after a 4 MP JPEG). Re-initializing the decoder after each decode
  drops it.
- **Scoped segmentation.** The per-pixel buffers (working image, OKLab,
  masks, labels, region ids: ~30 MB at 1.2 MP) now live in their own scope.
  They are garbage before curve fitting, and polygons and lattice points are
  released after fitting. Previously everything stayed referenced until
  traceImage returned. This was Quick's photo peak, at the fit stage.

The 128 MB limit also counts uncollected garbage between GCs. The sampled
workerd peak for a 4 MP photo in Professional is now ~91 MB, down from ~116 MB.
Memory cannot be measured on Cloudflare itself without deploying; the
staging measurement (2026-10-09) is under "Upload size" below.

### Resolution: is 4 MP / 1.2 MP enough for print?

Detail-heavy art was rendered at ~4 MP (what the browser sends after its
downscale). It was traced with working caps of 1.2, 2 and 4 MP and scored
against the vector truth at the full 4 MP size (`resstudy`, Professional
profile):

| Case (4 MP) | Working cap | ΔE×100 | Edge err (px of the 4 MP image) | Segments | KB | ms |
|---|---:|---:|---:|---:|---:|---:|
| typo-serif 2828×1414 | 1.2 MP | 0.58 | 0.75 | 3,136 | 73 | 1,330 |
| | 2.0 MP | 0.43 | 0.64 | 3,337 | 73 | 1,536 |
| | 4.0 MP | 0.19 | 0.38 | 3,454 | 65 | 2,841 |
| logo-complex 2000² | 1.2 MP | 0.18 | 0.61 | 653 | 17 | 869 |
| | 2.0 MP | 0.19 | 0.66 | 747 | 18 | 1,408 |
| | 4.0 MP | 0.06 | 0.25 | 523 | 12 | 1,999 |
| ornament 2000² | 1.2 MP | 0.21 | 0.59 | 603 | 17 | 751 |
| | 4.0 MP | 0.05 | 0.15 | 364 | 12 | 1,795 |
| hex-mosaic 2000² | 1.2 MP | 0.16 | 0.52 | 1,574 | 29 | 635 |
| | 4.0 MP | 0.06 | 0.22 | 572 | 13 | 2,131 |

Findings:

- At 1.2 MP, a 4 MP upload's edges are placed to within ~0.5–0.75 px of the
  4 MP image. Printed at 300 dpi that is ≤ 0.06 mm, below what the eye
  resolves on paper.
- Tracing at full 4 MP would halve-to-quarter that error, and gives fewer
  nodes and smaller files. But it needs ~35 B per working pixel (~140 MB),
  which a Worker cannot hold.
- 2 MP buys little.
- Conclusion at the time: keep the 4 MP upload limit and the 1.2 MP working
  size until a lower-memory engine exists. Superseded by "High-resolution
  engine" above, which traces artwork at full resolution.

### Still weak

- **An isolated hairline of ≤ 1 px with no other ink nearby** can vanish.
  This includes a single thin line on a plain background, as in a hairline
  drawing or signature. Bilinear upsampling plus blur turns it into beads
  whose gaps fall below the minimum coverage, and speckle cleanup then
  removes the beads. The same line next to other strokes, or ≥ 1.5 px wide,
  survives. Fixed by the ridge-preserving upsampler ("High-resolution
  engine").
- Small serif text is legible but its serifs and joins still break
  (typo-serif@512 ΔE 0.85).
- Quick posterizes gradients by design.
- Photos are a posterized approximation, and Professional photo SVGs are
  large (~1 MB each).

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
| **professional** | **0.17** | **0.46** | **0.12** | **0.0** | 3,815 | 88.4 | 25,551 |
| **quick** | **0.29** | **0.46** | **0.11** | **0.0** | 4,666 | 111.8 | 21,504 |
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
| flat-logo | 128 | 0.14 / 0.09 / 44 / 1.0 | 0.14 / 0.09 / 44 / 1.0 | 1.29 / 0.37 / 18.8 / 397 / 9.0 |
| flat-logo | 512 | 0.04 / 0.09 / 51 / 1.0 | 0.04 / 0.09 / 51 / 1.0 | 0.21 / 0.36 / 4.0 / 427 / 20.6 |
| flat-logo | 512jpg | 0.12 / 0.10 / 119 / 2.2 | 0.12 / 0.10 / 116 / 2.2 | 0.81 / 0.38 / 23.4 / 4092 / 117.7 |
| wordmark | 256 | 0.59 / 0.16 / 212 / 5.3 | 0.59 / 0.16 / 212 / 5.3 | 2.26 / 0.50 / 35.6 / 1080 / 24.7 |
| wordmark | 768 | 0.17 / 0.18 / 333 / 6.0 | 0.19 / 0.18 / 283 / 5.9 | 1.16 / 0.41 / 9.4 / 2697 / 51.3 |
| wordmark | 768jpg | 0.22 / 0.18 / 392 / 7.5 | 0.26 / 0.20 / 333 / 6.7 | 1.10 / 0.76 / 84.7 / 6757 / 212.1 |
| line-icon | 64 | 0.29 / 0.08 / 33 / 0.6 | 0.29 / 0.08 / 33 / 0.6 | 2.93 / 0.63 / 6.9 / 160 / 4.7 |
| line-icon | 256 | 0.07 / 0.08 / 62 / 0.9 | 0.07 / 0.08 / 62 / 0.9 | 0.73 / 0.44 / 0.9 / 266 / 12.6 |
| sticker | 160 | 0.06 / 0.07 / 37 / 1.2 | 0.06 / 0.07 / 37 / 1.2 | 0.26 / 0.34 / 8.6 / 418 / 17.3 |
| sticker | 512 | 0.02 / 0.09 / 49 / 1.4 | 0.02 / 0.09 / 49 / 1.4 | 0.07 / 0.34 / 4.0 / 1131 / 53.3 |
| fine-detail | 256 | 0.31 / 0.13 / 239 / 6.8 | 0.31 / 0.13 / 239 / 6.8 | 1.11 / 0.32 / 26.2 / 1537 / 67.8 |
| fine-detail | 768 | 0.19 / 0.22 / 180 / 5.2 | 0.19 / 0.22 / 180 / 5.2 | 0.37 / 0.34 / 6.1 / 3182 / 139.6 |
| wedges | 128 | 0.11 / 0.09 / 139 / 3.7 | 0.11 / 0.09 / 139 / 3.7 | 0.91 / 0.33 / 58.1 / 410 / 10.3 |
| wedges | 512 | 0.03 / 0.08 / 134 / 3.4 | 0.03 / 0.08 / 134 / 3.4 | 0.56 / 0.33 / 18.3 / 1679 / 42.4 |
| wedges | 512jpg | 0.12 / 0.15 / 443 / 11.1 | 0.12 / 0.15 / 367 / 9.2 | 0.63 / 0.45 / 19.9 / 3251 / 90.8 |
| mascot | 200 | 0.16 / 0.11 / 103 / 3.2 | 0.16 / 0.11 / 103 / 3.2 | 0.87 / 0.34 / 60.4 / 576 / 19.3 |
| mascot | 600 | 0.10 / 0.17 / 143 / 3.5 | 0.10 / 0.17 / 143 / 3.5 | 0.41 / 0.30 / 15.0 / 1472 / 52.0 |
| mascot | 600jpg | 0.25 / 0.17 / 151 / 3.6 | 0.25 / 0.17 / 173 / 4.0 | 0.56 / 0.38 / 59.6 / 7923 / 218.6 |
| gradient-mark | 256 | 0.06 / 0.10 / 34 / 1.1 | 0.58 / 0.05 / 157 / 3.9 | 0.74 / 0.41 / 16.5 / 682 / 15.4 |
| gradient-banner | 384 | 0.14 / 0.08 / 107 / 3.0 | 1.05 / 0.07 / 389 / 10.5 | 1.27 / 0.39 / 4.5 / 530 / 11.6 |
| gradient-banner | 384jpg | 0.24 / 0.05 / 202 / 6.2 | 1.22 / 0.06 / 609 / 16.8 | 1.35 / 0.39 / 26.5 / 1026 / 31.2 |
| radial-glow | 256 | 0.04 / 0.09 / 61 / 2.0 | 0.75 / 0.10 / 266 / 6.7 | 0.69 / 0.38 / 9.3 / 1245 / 25.6 |
| qr-like | 256 | 0.58 / 0.11 / 431 / 5.8 | 0.58 / 0.11 / 431 / 5.8 | 2.43 / 0.27 / 0.0 / 1599 / 35.8 |
| blueprint | 512 | 0.05 / 0.06 / 51 / 1.0 | 0.05 / 0.06 / 51 / 1.0 | 0.77 / 0.39 / 0.0 / 180 / 3.1 |
| signature | 384 | 0.07 / 0.15 / 65 / 1.8 | 0.07 / 0.15 / 65 / 1.8 | 0.33 / 0.56 / 51.3 / 1318 / 33.8 |

Resource checks (`traceImage` worst cases, Node 22): a 1600×1200 photo-like
input takes 2.7 s with about 33 MB heap growth; 1000×1000 pure noise is bounded to
about 1,650 regions and under 1 MB of SVG by the region budget; 4000×3000 inputs
are area-downsampled to the 1.2 MP working cap (uploads above 4 MP are
rejected by the API and downscaled in the browser first; see "Memory" below).

## Launch readiness (2026-10-04)

Full corpus (80 images, Quick and Professional) against the audit baseline:
0 failed, **0 regressions, no variant changed**. The dense-pattern change
below never triggers on the corpus.

**Dense regular patterns.** On a checkerboard, merging small regions to meet
the region budget recoloured neighbours in a cascade until the whole board
became one path. The budget pass now undoes a merge round that collapses the
image (fewer than a quarter of the budget left), as long as the region count
is at most `maxRegionsHard` (40,000). Above that, merging stays, as the
memory guard.

| 2000² checkerboard | Squares | Paths before → after | Time | Live peak |
|---|---:|---:|---:|---:|
| 32 px squares | 3,969 | 7,937 | 2.7 s | n/a |
| 16 px squares | 15,625 | 1 → **31,249** | 4.8 s | 59.8 MB (budget 68 MB) |
| 8 px squares | 62,500 | 1 (above the hard cap) | 2.9 s | n/a |

Keeping 125k regions (8 px) was estimated at about 122 MB, too close to the
128 MB isolate limit. The undo copy of the labels raises the Quick 4 MP
artwork peak from 39.5 to 43.1 MB, within its 46 MB budget.

**Upload size.** A 15.5 MB 16-bit PNG peaks at about 88 MB in workerd at
decode time (file, decoder and pixels), and a 25 MB file was estimated at
about 110 MB. Paid plans are therefore capped at 15 MB.

**On Cloudflare (staging, 2026-10-09).** A temporary probe Worker ran the
conversion's decode → analysis → trace calls in Cloudflare's runtime while
holding N MB of extra memory, and a binary search found the largest N that
still completed. Without an image the isolate was stopped (`exceededMemory`)
above 252–254 MB of extra memory, so a trace's peak is that ceiling minus
the ceiling with the trace (±3 MB): 4 MP logo ~41–43 MB, 4 MP noisy 4:4:4
JPEG ~33 MB, 15.6 MB 16-bit 4 MP PNG ~57 MB, 2000² 8 px checkerboard
~49 MB, 2000² 16 px checkerboard ~63 MB (the largest). Every case finished
with `outcome: ok` in 3.6–7.9 s of CPU time. All are below the 88 MB workerd
figure. Cloudflare enforced at about twice the documented limit here, which
it may change at any time, so the documented 128 MB stays the design budget.
The worst case leaves about 65 MB below it.
Details and the method are in DEPLOYMENT.md, "Memory on Cloudflare".

## Emblems (2026-10-10)

A customer compared a complex state emblem traced by Vectorla and by
Vectorizer.AI. Vectorizer.AI kept the text, shield contours, central emblem,
small symbols, shading and silhouette much better; Vectorla Quick and
Professional both broke the image into coarse color regions, and
Professional was hardly better than Quick. The customer's file was not
available, so an adversarial corpus of the same class was built.

`backend/src/benchmark/emblemCorpus.ts`: 7 designs × 4 variants (PNG 600,
1200, 2000 px; JPEG q85 at 1200 or q75 at 800) = 28 rasters per engine.

| Case | What it stresses |
|---|---|
| seal-circular | Navy/gold seal: circular serif text, laurel, shield, cream disk on white |
| crest-gold | Metallic gold gradients, off-center radial red/blue fields, crown jewels, motto on a banner |
| badge-metal | 48-point silver rosette, bevels, off-center radial disk, gold-gradient "100%", circular text |
| emblem-engraved | Hatching, rays, open book, torch with a flame gradient |
| patch-mountain | Stitched border, sky gradient, mountains, outlined arc text |
| wreath-emblem | State-emblem style: ~160 wheat grains with outlines, striped ribbon, sun glow with 36 rays and texture, bird, 8-point star with crescent, soft shadows, small text |
| seal-embossed | Brushed-metal texture, 72 rivets, embossed circular text, crossed keys |

`npm run bench -- --corpus=emblem --engines=quick,professional --out=DIR` writes
the renders; `src/benchmark/emblemDiagnostics.ts` prints what each stage did
(palette size, regions after speckle cleanup, region-budget passes, gradients
found and kept, regions refined, photo cap). `emblemGate.smoke-test.ts` is the
regression gate (part of `npm test`); `baseline-emblem.json` is the committed run.

### Root causes

Measured on the corpus before any change, with the stage diagnostics and
crops of every case:

1. **One coarse palette for everything.** The palette merges colors closer
   than `mergeDistance` (0.05 OKLab, about 2.5 just-noticeable differences),
   so shading came out as 3–5 hard bands and a gradient's dark end merged
   with whatever similar color touched it (wheat grains melted into their
   stalk). Palettes held 4–35 colors, far under the 32/64 caps.
   Professional's only palette difference (0.045) added 1–3 colors: Quick
   and Professional differed on 0.79% of pixels.
2. **Greedy palette seeding absorbed flat inks.** Any color within
   `mergeDistance` of a more common one joined it before the separation test
   (two tight, well-separated inks stay apart) could run. Quick painted the
   seal's cream inner disk and the white background one color (ΔE 1.38 vs 0.37).
3. **Radial gradients were missed.** Radial clusters joined every adjacent
   pair of varying regions, across real edges, and took the bands' centroid
   as the center. Off-center glows (a highlight up and left, a field clipped
   by a shield) never fitted, so Professional posterized them like Quick.
4. **The photo cap halved textured emblems for nothing.** Below 70% flat
   pixels an image counts as photo-like and is reduced to 1.2 MP. A 1200²
   textured seal was halved to 600² and then auto-upsampled back to 1200²:
   same working size and memory (15.5 MB live), half the detail.
5. **Speckle cleanup judged by area only.** It merged over 90% of labeled
   regions on the heavy cases, including small details that contrast with
   everything around them (light gaps between dark outlines).

Neither the 4 MP working cap (no emblem variant exceeds it except 2000 px,
traced at full size) nor the region budget (never triggered: 0 passes) was a
cause.

### Changes

| Change | Where | Modes |
|---|---|---|
| **Shading refinement.** After gradients, each region whose interior colors spread smoothly along one color direction is re-quantized into levels 0.02 apart; the edge band and merged specks take the nearest interior level, and level islands under twice the level size rejoin a neighbour. Noise is left alone: foreign-colored specks are excluded, and a spread that does not survive local averaging is not refined. | `engine/refine.ts` | Professional |
| **Radial center search.** A radial cluster's center is searched (grid, then halving local search) to minimize a piecewise radial color profile. The cluster counts as radial only if that profile clearly beats the same piecewise profile along the linear direction (otherwise a far center imitates a multi-stop linear ramp) and its color rises over at least 35% of the radius (a flat disk whose blurred rim reads as concentric bands rises within a bin or two). | `engine/gradients.ts` | Professional |
| **Gradients only across posterization cuts.** Regions join a gradient group only across borders whose mean pixel step is at most 0.03 (sRGB): the bands of one ramp, not a shape on a background. | `engine/gradients.ts` | Professional |
| **Flat-ink seeding.** A heavy histogram bin that towers over its neighbours (a flat ink) seeds its own cluster down to 0.4 × `mergeDistance` from an earlier one, so the Ward pass decides with its separation test. | `engine/palette.ts` | both |
| **Detail-aware speckle cleanup.** A region under the speckle area is kept when it contrasts with the region it would merge into by at least 0.15 OKLab and covers at least a quarter of the speckle area and 3 source pixels. | `engine/regions.ts`, `traceImage.ts` | both |
| **Photo cap only when it saves something.** The cap is skipped when auto-upsampling would bring the reduced image back to at least its own size. | `engine/traceImage.ts` (`workingPixelCap`) | both |

Tried and rejected (each measured on the full emblem corpus, and on the
core and real-world corpora where it got that far):

- **A finer global palette for Professional** (`mergeDistance` 0.03 or 0.022). Shading improved
  (badge ΔE 1.25 → 0.94), but on JPEG the halos and ringing around hairlines became palette
  colors: hatching broke into dashes (emblem-engraved JPEG ΔE 0.51 → 1.33).
- **Seeding every cluster at half the merge distance.** Fixed the cream disk, but the Ward pass
  then spaced gradient levels up to twice as far apart (core gradient-banner Quick ΔE 1.04 → 1.32)
  and a blurred logo grew halo colors (1.1k → 4.6k segments).
- **Refining from each pixel's own color, or refining before gradient detection.** Halos of merged
  noise came back as level islands (a 64 px salt-and-pepper test went from 2 paths to 253), and
  finer flat levels beat partial gradient fills in the per-region validation, leaving seams.
- **Shading step 0.015.** ΔE 0.58 → 0.55 on the emblems for +28% bytes and +34% time.
- **`mergeDistance` 0.04 for Professional, half the speckle area.** Mixed or worse.
- **Blending edge pixels with palette colors not in reach** (for the thin outline around small
  text, which mixes three colors). No visible change.

### Before and after (28 emblem rasters per engine)

| Metric | Quick before | Quick after | Professional before | Professional after |
|---|---:|---:|---:|---:|
| Mean ΔE×100 | 0.93 | **0.76** | 0.66 | **0.50** |
| Mean edge error (px) | 0.25 | **0.23** | 0.26 | **0.23** |
| Worst edge error (px) | 0.52 | **0.49** | 0.51 | **0.48** |
| Edge recall¹ | 0.953 | 0.971 | 0.952 | 0.971 |
| Small regions kept¹ | 8,516 / 8,751 | 8,588 / 8,751 | 8,532 / 8,751 | 8,616 / 8,751 |
| Segments | 200,775 | 217,891 | 205,516 | **186,837** |
| Total SVG (KB) | 4,969 | 5,407 | 5,161 | **4,704** |
| Trace time, all 28 (s)² | 59.3 | 59.6 | 67.0 | 88.4 |
| Seams | 0 | 0 | 0 | 0 |

¹ From the 4× renders, ±1 source px tolerance: edge recall is the share of true
color edges (OKLab step > 0.08) the trace reproduces; a small region is a
6–600 source-px area of one quantized truth color whose core keeps its color
(mean ΔE < 0.08). ² One process, nothing else running.

Professional's mean ΔE is now 0.65× Quick's (0.71× before). Per case (mean
of the 4 variants), the lead grew where emblems need it, in shading:

| Case | Quick before | Professional before | Quick after | Professional after |
|---|---:|---:|---:|---:|
| badge-metal | 1.32 | 1.06 | 1.31 | **0.56** |
| crest-gold | 0.61 | 0.45 | 0.61 | **0.31** |
| seal-embossed | 1.38 | 1.30 | 1.26 | **0.98** |
| wreath-emblem | 0.92 | 0.78 | 0.90 | **0.72** |
| patch-mountain | 0.88 | 0.40 | 0.62 | **0.32** |
| seal-circular | 1.04 | 0.28 | **0.28** | 0.28 |
| emblem-engraved | 0.32 | 0.31 | 0.32 | 0.31 |

On the four shaded designs Professional is now 20–57% below Quick (6–26%
before). On flat line art (engraved, seal-circular) the modes are equal, as
intended: both keep the same detail. The raw share of pixels where the two
modes differ by more than ΔE 0.05 fell from 0.79% to 0.64%, because Quick's
cream-disk error (whole-background differences) is gone; gradients differ
from bands by less than 0.05 per pixel, over large areas. No variant got
worse by more than 0.001 ΔE in either mode.

Visual review (crops of every case, both modes, before and after): radial
fields and glows (crest, badge disk, sun) are now smooth SVG gradients with
the highlight in the right place; metallic and textured shading has more,
finer levels instead of hard bands (badge-metal@1200: 17 → 36 flat colors
plus 12 gradients); the 1200² embossed seal is traced at full
size; the cream disk is its own color in Quick. Hairlines and hatching on
JPEG are unchanged (no new halo colors).

**Other corpora.** Core (25 variants): unchanged (Professional ΔE 0.16,
Quick 0.29; no variant moved by more than 0.001). Real-world (55 images):
Quick ΔE 0.696 → 0.689, Professional 0.663 → 0.643, edge error unchanged, no
seams; the largest single loss is +0.007 (emoji-fox@256). Total SVG size +3%
(Quick) and +11% (Professional), mostly photos, which gain finer tone levels
(Professional ΔE 2.71 → 2.62). The core and real-world baselines were
refreshed with these runs. All gates pass.

**Memory and time.** Live peak with forced GC at every checkpoint
(`memory.smoke-test.ts`, same method as above): 4 MP artwork 39.5 MB Quick,
40.0 MB Professional (budget 46); a new shaded 4 MP case that exercises
shading refinement peaks at 43.2 MB inside it (budget 50). On the 4 MP
emblems: Quick 39.5 → 39.5–39.9 MB, Professional 39.5 → 43.7–43.9 MB, the
refinement's one byte per pixel (an interior-distance map) alive beside the
label, id and image buffers. No memory or CPU limit was changed. Trace time on the emblems: Quick unchanged (59.6 s for all 28),
Professional +32% (67.0 → 88.4 s; about 2 s more per 4 MP trace, 3.5–4.3 →
5.5–6.2 s), mostly the window-averaged level choice and the radial center
search, well inside the 60 s CPU limit.

### Remaining gap to Vectorizer.AI

- **Thin outlines around small text at ≤ 600 px.** A 1 px dark outline between a white letter and
  a blue field blends three colors; the labeler explains pixels as two-color blends, so the
  outline comes out as an offset, dotted shadow (patch-mountain@600).
- **Tiny repeated shapes on low-resolution JPEG.** Wheat grains about 9 px wide at 800 px q75 lose
  their 1 px outlines and merge with the stalk; detail protection keeps more of the gaps, but the
  grains stay blobby.
- **Multi-stop metallic linear gradients** (a crown's light-dark-light gold) are finer bands, not
  one gradient: linear grouping still requires one straight ramp per group.
- **Fine texture** (brushed metal, noise filters) becomes soft blotches in both modes.
- **Small circles and star tips on JPEG** are slightly polygonal or rounded (curve fitting at a few
  pixels per shape).
- **Not measured head-to-head.** Comparing on the customer's own emblem needs that file and
  Vectorizer.AI's output for it; both can be added to the emblem corpus as a raster case.

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
| Gradients reproduced as gradients | ✅ Met (Professional) | Linear and radial gradients are reconstructed as SVG gradients: ΔE 0.04–0.23 vs 0.58–1.06 posterized. Off-center radial fills are found by a center search (emblems: metal badge ΔE 1.06 → 0.49). Other shading gets finer flat levels. Quick keeps flat bands for print and cut work. Multi-stop metallic ramps, conic and mesh-like shading are not modeled as one gradient. |
| Complex emblems, seals and crests | ⚠️ Partial | Emblem corpus (28 rasters): Professional ΔE 0.66 → 0.50, Quick 0.93 → 0.76; Professional 20–57% below Quick on shaded designs. Still weak: 1 px outlines around small text at ≤ 600 px, tiny outlined shapes on low-res JPEG, metallic multi-stop ramps (see "Emblems"). |
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
| 2026-10-03 | Optimization round: palette separation, ridge promotion for thin strokes, size-relative precision, memory (single decode, early downscale, decoder reset, scoped buffers) | 0.52 (Pro) / 0.58 (Quick), 80 images | 0.13 | 0 |
| 2026-10-04 | Launch readiness: dense-pattern undo below 40,000 regions (16 px checkerboard 1 → 31,249 paths) | 0.50 (Pro) / 0.57 (Quick), 80 images, 0 regressions, byte-identical | 0.12 | 0 |
| 2026-10-10 | Emblems: shading refinement, radial center search, gradients only across band cuts (Professional); flat-ink seeding, detail-aware speckle cleanup, photo cap only when it saves memory (both) | Emblems 0.50 (Pro) / 0.76 (Quick), was 0.66 / 0.93; core 0.16 / 0.29 unchanged; real-world 0.64 / 0.69 | 0.23 emblems; 0.11–0.13 others | 0 |
