# Vectorla — Roadmap

Prioritized from the full repository audit (2026-09-26). The most important
metric is **vector output quality** (see BENCHMARKS.md), so quality work leads
the roadmap. Production-safety defects that can lose customer money or take
the service down are listed next, because they block launch regardless of quality.

Legend: ✅ done · 🔜 next · ⏳ planned · 🧑 needs an owner decision, credential or payment

---

## Audit summary

### Tracing engine: state before this work

- Quick Trace ran ImageTracer.js with 9 hand-tuned presets, picked by a
  pixel-statistics heuristic. Colors were traced layer by layer, with a
  same-color 1 px stroke to hide seams, which fattens every shape.
  Anti-aliasing produced halo colors, and output averaged 41k segments and
  1.25 MB across the corpus.
- The "Professional" pipeline ran six whole-image filters (box blur,
  border-color flattening, auto-levels, uniform 6-level RGB quantization,
  unsharp mask) *before* ImageTracer. Measured, it was **far worse than Quick**:
  5.95 px mean edge error, up to 23 px, while customers paid 2× credits for it.
- Potrace was used only as a monochrome alternative. Vision and OpenAI
  providers were stubs; AI upscaling was a no-op.
- Quality was assessed with structural proxies only (path count, curve
  ratio). Nothing ever rendered the output.

### Tracing engine: gap analysis vs professional tools

| Capability | Before | Now |
|---|---|---|
| Preprocessing | Destructive global filters | Edge-preserving bilateral denoise (JPEG/noise-aware), alpha-aware super-sampling |
| Image classification | Heuristic preset picker | Still used for analysis/UI; the engine adapts itself (palette, detail pass, noise) |
| Engine architecture | Per-color layer tracing | Planar map: one shared, fitted boundary per pair of regions |
| Color quantization | ImageTracer k-means in RGB, AA colors included | OKLab palette from flat pixels, blend-cluster removal, thin-detail color pass |
| Edge/path quality | Staircase-prone, strokes hide seams | Potrace digital-straightness polygon, sub-pixel vertex adjustment |
| Curve fitting | Quadratic splines | Cubic Béziers + curve-merging optimization |
| Corner detection | ImageTracer `rightangleenhance` | alphamax smoothing + polygon-level corner restoration |
| Shape simplification | `pathomit` deletes small paths (leaves holes) | Speckles merged into the best neighbor; adaptive region budget |
| Noise removal | 3×3 box blur | Bilateral denoise + region merge + local-color preference |
| Layered color reconstruction | Overlapping layers + strokes | Stacked mode (seamless) and exact cutout mode |
| Transparency | Alpha lost or noisy | 50%-coverage alpha contour; transparent regions are never drawn |
| Gradients | Banding | Still banding: **Q3** |
| Text/logo handling | Small text dropped or blobby | Small text kept (detail pass), exact colors |
| Small details | Lost to `pathomit` | Kept down to ~2–3 source px² (size-aware speckle threshold) |
| SVG optimization | Regex cleanup | Relative commands, minimal numbers, h/v, drift-free rounding |
| Upscaling / vision | No-op | Interpolated super-sampling (1–4×); ML upscaling planned (**Q12**) |

### Platform audit: highest-risk findings (details in the audit notes below)

1. **Critical: nothing grants credits in production.** The signup trigger
   creates a profile with 0 credits and the monthly grant is never called, so
   every production conversion fails its credit check.
2. **Critical: decompression bomb.** No pixel-dimension check before decode;
   a 5 MB PNG declaring 30000×30000 expands to about 3.6 GB.
3. **Critical: jobs can stick in `processing` forever** after a Worker crash
   (redelivery sees `processing` → ConflictError → acked).
4. **High: credit races.** Balance is checked at start and debited at end with no
   `balance >= 0` constraint; refund and supersede paths can mint credits under
   concurrency; the balance update and ledger insert are separate writes.
5. **High: queue config** (`max_batch_size=10`, no DLQ, no retry delay, no
   CPU limit) is unsuited to CPU-heavy tracing.
6. **High: CSP blocks the workspace previews** (`img-src` lacks `blob:`).
7. **High: duplicate filenames get 409 in production**, and Retry re-uploads the same name.
8. **High: staging deploy would overwrite production** (same Worker, bucket, queue).
9. **High: marketing copy contradicts reality.** "Runs in your browser",
   "Unlimited", PDF/DXF/EPS output and batch processing are not implemented.
10. Medium: dev-bypass gated only by an env var; no rate limiting; upload body
    buffered before size check; every poll calls Supabase Auth; polling has no
    timeout; no migrations, retention, observability or CI.

---

## Milestones

### Tier 1: Vector quality (primary)

- ✅ **Q1. Vectorla native tracing engine** (`backend/src/engine/`): palette,
  AA-aware segmentation, planar map, Potrace-grade fitting, corner restoration,
  junction refinement, stacked/cutout SVG. Pure TypeScript and Worker-safe.
- ✅ **Q2. Render-and-diff benchmark + quality gate**: ground-truth corpus,
  OKLab/edge/gap metrics, and a regression gate in `npm test`.
- ✅ **Q2b. Production integration**: every image type routes to the engine,
  Quick and Professional use engine profiles, ImageTracer is the automatic
  fallback, and the harmful preprocessing stages are removed.
- ✅ **Q3. Gradient reconstruction** (Professional differentiator). Done:
  linear and radial gradients, gradient ΔE 0.58–1.06 → 0.04–0.23 (BENCHMARKS.md).
  Follow-ups: off-center/focal radial gradients, leftover rim slivers on
  radial art, gradients under transparency.
  Original plan: Detect
  regions whose color varies smoothly (linear or radial fit of color vs.
  position) and emit `<linearGradient>`/`<radialGradient>` fills instead of
  bands; merge the bands back into one region. Target: gradient-mark ΔE
  0.59 → < 0.25, and far fewer paths on gradient art.
- ✅ **Q4. Lossy-source quality**: done. Luma-guided chroma restoration,
  blend-sliver dissolve, and edge labeling next to thin strokes. JPEG flat-logo
  716 → 77 segments; the JPEG wordmark's edge error 0.42 → 0.19 px. Follow-up: a heavy
  low-quality JPEG and phone-photo corpus. Original plan: chroma-aware cleanup for 4:2:0 JPEG, node
  reduction on noisy boundaries (curvature-aware simplification). Target: JPEG
  variants within 1.3× of PNG node counts and < 0.3 px edge error.
- ⏳ **Q5. Pinch points and pixel art**: resolve diagonal corner-to-corner
  contacts cleanly (QR, checkerboards); add a pixel-art mode (no super-sampling,
  exact square pixels); optional 8-connectivity for 1 px diagonal lines.
- ⏳ **Q6. Tangent continuity through junctions**: match tangents of chains
  that continue smoothly through a 3-color junction (removes small kinks on
  circles split by other shapes).
- ⏳ **Q7. Sub-pixel refinement at 1× working scale**: large images can't be
  super-sampled within Worker memory. Fit boundaries to the 50% coverage
  iso-contour directly, removing the ≤ 0.75 px flattening of big curves.
- ⏳ **Q8. Stroke / centerline output** for line art, signatures and
  CNC/laser/plotter users (single-line paths instead of filled outlines).
- ⏳ **Q9. Designer-grade SVG structure**: group by color (`<g>` layers),
  merge same-color stacked paths where z-order allows, detect primitives
  (circle, ellipse, rect, rounded rect), optional cutout mode in the UI.
- ⏳ **Q10. Real-world corpus**: extend the benchmark with real customer-like
  uploads (scans, phone photos of logos, low-quality JPEG). 🧑 Needs sample
  images that we have the rights to use.
- ⏳ **Q11. Head-to-head vs Vectorizer.ai** on the same corpus. 🧑 Needs a
  paid Vectorizer.ai API account and an owner decision to buy it.
- ⏳ **Q12. Vision assistance**: ML super-resolution for tiny or blurry inputs,
  text-region detection for font-aware fitting, subject/background separation.
  🧑 Provider and cost decision (Workers AI or external).
- ⏳ **Q13. User controls** (like professional tools): detail level, max
  colors / palette lock, corner sharpness, stacked vs cutout, transparency
  handling, all mapped to engine options.
- ⏳ **Q14. In-browser instant preview**: the engine is pure TypeScript, so a
  low-resolution preview can run client-side before upload, with the server
  producing the final output.
- ⏳ **Q15. Performance**: typed-array hot loops, and later WASM for the
  labeling/fitting stages to cut Worker CPU time (currently about 0.5–1 s per
  512 px image, 2.7 s at 2 MP).

### Tier 2: Production safety (launch blockers)

- ✅ **P1. Decompression-bomb guard**: parse PNG IHDR, JPEG SOF and WebP
  VP8/VP8L/VP8X dimensions before decode; reject anything over the megapixel limit.
- ✅ **P2. Job lease / stuck-job recovery** (also a DLQ consumer and a 15-min sweeper): `processing_started_at`, takeover
  after N minutes, ack only on terminal state; frontend polling timeout.
- ✅ **P3. Queue configuration**: `max_batch_size = 1`, explicit `cpu_ms`,
  DLQ, `max_retries`, retry delay.
- ✅ **P4. Credit integrity** (`supabase/migrations/0002_credit_integrity.sql`, verified on Postgres 16): atomic reserve/debit/refund in Postgres
  functions, `CHECK (balance >= 0)`, unique debit/refund per job, partial
  unique index for one active job per upload, and a refund on terminal failure.
- ✅ **P5. Free-credit grant on signup**: 10 credits via `handle_new_user`, with a backfill
  for existing users. 🧑 A recurring monthly grant for free users is a pricing
  decision and is not implemented.
- ⏳ **P6.** Done: CSP `blob:` for previews, HSTS, and `[env.staging]` in wrangler
  (separate Worker, bucket and queues) with a `DEPLOYMENT.md` runbook. Remaining: drop
  the duplicate-filename unique index; constant-time HMAC compare.
- ⏳ **P7.** Rate limiting (Workers Rate Limiting or Turnstile) and a stricter dev bypass.
- ✅ **P8.** CI (`.github/workflows/ci.yml`): lint and build, typecheck, `npm test`
  including the quality gate, Worker dry-run bundles, and a Postgres 16 job running
  schema + migration + credit-integrity assertions + a concurrency check.
- ⏳ **P9.** Observability: Workers observability and error tracking; a
  health check that probes dependencies.
- 🧑 **P10.** Supabase project `rvrpuapbeglqmcajsdgm` is **paused** (INACTIVE).
  The free org already has 2 active projects, so resuming needs an owner
  decision: pause another project or upgrade. Everything else is prepared
  offline and verified on Postgres 16: `preflight_0002.sql` (read-only
  check), service_role GRANTs (needed; kept in the owner's local schema.sql
  and mirrored in 0002), a signup grant that survives schema.sql re-runs,
  and an atomic 0002. The apply order is in DEPLOYMENT.md §2.

### Tier 3: Product and SaaS (after quality and safety)

- 🟡 **S1.** Honest marketing copy. Landing copy (EN/UZ/RU) now only claims what the
  engine does: no ratings, no "AI", SVG-only output, no batch/DXF/CMYK claims, and no
  mock workspace controls. The **Pricing section is unchanged** and still lists
  unbuilt features and plans; it needs an owner decision.
- ⏳ **S2.** PDF / EPS / DXF export from the engine's path model (straightforward
  now that output is clean cubic geometry); PNG re-render.
- 🟡 **S3.** Account UI. Done: credit balance in the navbar and workspace, and an
  `/account` page with credit history (GET /credits). Still to do: re-download of
  past conversions (GET /history).
- ⏳ **S4.** Batch upload and ZIP download.
- 🧑 **S5.** Stripe billing, checkout and portal. Needs account, keys and pricing decisions.
- 🟡 **S6.** Legal. `/privacy` and `/terms` are drafts with visible "Decision needed"
  markers (operator, contact, law, age, liability). Retention is proposed (30 days
  for files) but **not enforced** until the owner approves. User deletion is
  handled by email request only for now.

---

## Decisions needed from the owner

1. Buy a Vectorizer.ai API plan for head-to-head benchmarking (Q11)?
2. Provide or approve a set of real sample images for the corpus (Q10).
3. Vision/ML provider for upscaling and text detection, and its budget (Q12).
4. Free-tier credit amount and cadence (P5), Stripe setup (S5).
5. Resume the paused Supabase project when ready to deploy (P10).
