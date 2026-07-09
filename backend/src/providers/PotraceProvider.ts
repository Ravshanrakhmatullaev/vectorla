import type { Upload, ExportFormat } from '../types'
import type { VectorizationProvider, VectorizationResult } from './VectorizationProvider'
import { decodeImage, type RasterDecoderWasm } from './imageDecoder'
import { optimizeSvg } from './svgOptimizer'
import { PlaceholderProvider } from './PlaceholderProvider'
import { measureSvgQuality } from '../qualityTesting/svgQualityMetrics'
import { imageDataToBitmap, traceBitmap, getSVG, calculateAutoThreshold, type PotraceOptions } from '@cadit-app/potrace-ts'

/**
 * Tuned once for the monochrome flat-mark content this provider targets
 * (logos, signatures, QR codes, stamps, simple icons — Phase 24), not
 * per-category like ImageTracer's 9 named profiles (tracePresets.ts):
 * Potrace has far fewer knobs, and none of them are anywhere near as
 * content-sensitive as ImageTracer's color quantization — a single
 * well-tuned config measured to hold up across all 5 target categories (see
 * PotraceProvider.smoke-test.ts) is enough.
 *   - turnpolicy 'minority': at ambiguous turns, prefers the path that
 *     keeps more of the image to the right — measured to produce visibly
 *     cleaner corners than the package's own 'right' default on our
 *     QR/logo test images (fewer spurious extra nodes at block corners).
 *   - turdsize 3: slightly above the package default (2) — despeckles the
 *     kind of small ink-coverage gaps a worn rubber stamp impression or a
 *     scanned signature can have, without being high enough to erase real
 *     fine detail (see the stamp/signature comparisons).
 *   - alphamax 1 (default): a middle ground between "everything is a sharp
 *     corner" (QR modules) and "everything is smooth" (a signature's
 *     curves) — since one config has to serve both, we don't chase either
 *     extreme.
 */
const POTRACE_OPTIONS: Partial<PotraceOptions> = {
  turnpolicy: 'minority',
  turdsize: 3,
  optcurve: true,
  alphamax: 1,
  opttolerance: 0.2,
}

/**
 * Real bitmap-tracing implementation (Phase 24) using @cadit-app/potrace-ts
 * — pure TypeScript, no DOM/fs dependency, so it runs directly in Cloudflare
 * Workers the same way PlaceholderProvider's jSquash decoders do. A good
 * fit for flat, effectively-monochrome marks (logos, signatures, QR codes,
 * stamps, simple icons) where a binary-threshold trace produces cleaner,
 * smaller output than ImageTracer's full-color quantization pipeline.
 *
 * ProviderSelector.ts routes monochrome content here as a heuristic
 * starting point, not a guarantee it's always the better choice for a
 * given image — so this compares its own Potrace trace against
 * PlaceholderProvider's ImageTracer trace on the same bytes and keeps
 * whichever measures objectively better (fewer nodes, tie-broken by
 * smaller file size — see pickBetterResult). This happens entirely inside
 * this provider; ConversionService and ProviderFactory are unchanged and
 * have no idea the comparison is happening.
 */
export class PotraceProvider implements VectorizationProvider {
  readonly name = 'potrace'

  constructor(private readonly wasm: RasterDecoderWasm) {}

  async vectorize(upload: Upload, fileBytes: ArrayBuffer, requestedPreset?: string | null): Promise<VectorizationResult> {
    const imageData = await decodeImage(upload.mimeType, fileBytes, this.wasm)

    const potraceResult = this.traceWithPotrace(imageData)

    // ImageTracer (PlaceholderProvider) still runs on the exact same
    // decoded pixels and requestedPreset a caller going straight to it
    // would get — this is a genuine apples-to-apples comparison, not a
    // biased one.
    const imageTracerProvider = new PlaceholderProvider(this.wasm)
    const imageTracerResult = await imageTracerProvider.vectorize(upload, fileBytes, requestedPreset)

    return pickBetterResult(potraceResult, imageTracerResult)
  }

  /** Exposed for callers/tests that want the raw Potrace trace without the ImageTracer comparison — see PotraceProvider.smoke-test.ts. */
  async traceOnly(upload: Upload, fileBytes: ArrayBuffer): Promise<VectorizationResult> {
    const imageData = await decodeImage(upload.mimeType, fileBytes, this.wasm)
    return this.traceWithPotrace(imageData)
  }

  private traceWithPotrace(imageData: ImageData): VectorizationResult {
    const threshold = calculateAutoThreshold(imageData)
    const bitmap = imageDataToBitmap(imageData, threshold)
    const paths = traceBitmap(bitmap, POTRACE_OPTIONS)
    const rawSvg = getSVG(paths, 1)
    const svg = optimizeSvg(rawSvg, { width: imageData.width, height: imageData.height })
    return {
      data: new TextEncoder().encode(svg).buffer as ArrayBuffer,
      format: 'svg' as ExportFormat,
    }
  }
}

/**
 * Objective, measurement-based tie-break (Phase 24 task requirement:
 * "automatically keep the better result") — fewer total nodes wins (the
 * same signal tracePresets.smoke-test.ts's budgets are built around),
 * smaller file size breaks a tie. Deliberately simple and reproducible
 * rather than a subjective visual judgment this environment can't make.
 */
function pickBetterResult(a: VectorizationResult, b: VectorizationResult): VectorizationResult {
  const aMetrics = measureSvgQuality(new TextDecoder().decode(a.data))
  const bMetrics = measureSvgQuality(new TextDecoder().decode(b.data))
  if (aMetrics.nodeCount !== bMetrics.nodeCount) {
    return aMetrics.nodeCount < bMetrics.nodeCount ? a : b
  }
  return aMetrics.svgSizeBytes <= bMetrics.svgSizeBytes ? a : b
}
