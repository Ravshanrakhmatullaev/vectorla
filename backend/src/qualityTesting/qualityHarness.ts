// Quality-testing harness library (Phase 21, retuned/expanded Phase 23) —
// runs the real pipeline (decode -> ImageAnalysisService ->
// tracePresetSelector -> ImageTracer -> optimize) against one synthetic
// stand-in per real-world upload category (see testSupport/qualityTestImages.ts),
// measures processing time / SVG size / path count / node count /
// auto-selected profile, and flags common problems via svgQualityMetrics.ts.
// A pure library (no auto-run side effect) so it can be imported both by
// runQualityHarness.ts (the CLI report) and tracePresets.smoke-test.ts (as
// an assertion) without running twice — see runQualityHarness.ts.
import { PlaceholderProvider } from '../providers/PlaceholderProvider'
import { createImageAnalysisService } from '../services/ImageAnalysisService'
import { loadDecoderWasmModules } from '../testSupport/wasmTestFixtures'
import { encodeTestPng, encodeTestJpeg } from '../testSupport/rasterEncode'
import { buildQualityTestImages, type QualityTestImage } from '../testSupport/qualityTestImages'
import { measureSvgQuality, detectProblems, type QualityBudget, type ProblemFlag } from './svgQualityMetrics'
import type { Upload } from '../types'

// Heuristic, category-specific acceptance budgets — there's no way to
// visually eyeball output in this environment, so these encode what "good
// enough for a print-ready vector" should structurally look like per
// category. See QUALITY_REPORT.md for the caveat this implies.
export const QUALITY_BUDGETS: Record<string, QualityBudget> = {
  'simple-logo': { hasCurvedSilhouette: true, maxSvgBytes: 15_000, maxPathCount: 30, maxNodeCount: 400 },
  'monochrome-logo': { hasCurvedSilhouette: false, maxSvgBytes: 15_000, maxPathCount: 20, maxNodeCount: 400 },
  'colorful-logo': { hasCurvedSilhouette: true, maxSvgBytes: 40_000, maxPathCount: 60, maxNodeCount: 1200 },
  gradient: { hasCurvedSilhouette: false, maxSvgBytes: 150_000, maxPathCount: 800, maxNodeCount: 20_000 },
  mascot: { hasCurvedSilhouette: true, maxSvgBytes: 60_000, maxPathCount: 100, maxNodeCount: 2500 },
  sticker: { hasCurvedSilhouette: true, maxSvgBytes: 30_000, maxPathCount: 50, maxNodeCount: 1200 },
  icon: { hasCurvedSilhouette: true, maxSvgBytes: 8_000, maxPathCount: 15, maxNodeCount: 300 },
  'low-res-logo': { hasCurvedSilhouette: true, maxSvgBytes: 8_000, maxPathCount: 20, maxNodeCount: 300 },
  'transparent-png': { hasCurvedSilhouette: true, maxSvgBytes: 60_000, maxPathCount: 150, maxNodeCount: 3000 },
  'jpeg-photo': { hasCurvedSilhouette: false, maxSvgBytes: 250_000, maxPathCount: 2000, maxNodeCount: 40_000 },
  signature: { hasCurvedSilhouette: false, maxSvgBytes: 15_000, maxPathCount: 15, maxNodeCount: 600 },
  'qr-code': { hasCurvedSilhouette: false, maxSvgBytes: 60_000, maxPathCount: 250, maxNodeCount: 3000 },
  blueprint: { hasCurvedSilhouette: true, maxSvgBytes: 15_000, maxPathCount: 15, maxNodeCount: 500 },
  // hasCurvedSilhouette is false here on purpose: unlike a mascot/icon's
  // clean geometric circle, a hand-drawn sketch's contour is *supposed* to
  // be irregular — a low curveCommandRatio isn't a real defect for this
  // category the way it is for a shape that should read as perfectly round.
  // The denoising this profile needs (see tracePresets.ts's sketch entry)
  // does cost curve smoothness; that's an accepted, measured trade-off, not
  // an oversight.
  sketch: { hasCurvedSilhouette: false, maxSvgBytes: 40_000, maxPathCount: 100, maxNodeCount: 1500 },
}

export interface QualityResult {
  id: string
  label: string
  category: string
  mimeType: string
  sourceDimensions: string
  conversionTimeMs: number
  svgSizeBytes: number
  pathCount: number
  nodeCount: number
  curveCommandRatio: number
  selectedPreset: string
  colorCountEstimate: number
  complexityScore: number
  problems: ProblemFlag[]
}

function makeUpload(image: QualityTestImage): Upload {
  return {
    id: `upload-${image.id}`,
    userId: 'quality-test-user',
    originalFileName: `${image.id}.${image.mimeType === 'image/jpeg' ? 'jpg' : 'png'}`,
    mimeType: image.mimeType,
    sizeBytes: 0,
    storageKey: `uploads/quality-test-user/upload-${image.id}/${image.id}`,
    status: 'stored',
    createdAt: new Date().toISOString(),
  }
}

export async function runQualityHarness(): Promise<QualityResult[]> {
  const wasm = await loadDecoderWasmModules()
  const provider = new PlaceholderProvider(wasm)
  const imageAnalysisService = createImageAnalysisService(wasm)
  const images = buildQualityTestImages()
  const results: QualityResult[] = []

  for (const image of images) {
    const bytes = image.mimeType === 'image/jpeg' ? await encodeTestJpeg(image.imageData) : await encodeTestPng(image.imageData)
    const upload = makeUpload(image)

    // Mirrors ConversionService.processJob (Phase 23): analyze first, then
    // trace with whatever profile tracePresetSelector.ts actually
    // recommends — not PlaceholderProvider's own narrower standalone
    // fallback (see PlaceholderProvider.smoke-test.ts for that path instead).
    const analysis = await imageAnalysisService.analyze(upload, bytes)

    const start = performance.now()
    const result = await provider.vectorize(upload, bytes, analysis.recommendedTracePreset)
    const conversionTimeMs = performance.now() - start

    const svg = new TextDecoder().decode(result.data)
    const metrics = measureSvgQuality(svg)
    const budget = QUALITY_BUDGETS[image.id]
    if (!budget) throw new Error(`No quality budget defined for test image "${image.id}"`)
    const problems = detectProblems(metrics, budget)

    results.push({
      id: image.id,
      label: image.label,
      category: image.category,
      mimeType: image.mimeType,
      sourceDimensions: `${image.imageData.width}x${image.imageData.height}`,
      conversionTimeMs,
      svgSizeBytes: metrics.svgSizeBytes,
      pathCount: metrics.pathCount,
      nodeCount: metrics.nodeCount,
      curveCommandRatio: metrics.curveCommandRatio,
      selectedPreset: analysis.recommendedTracePreset,
      colorCountEstimate: analysis.colorCountEstimate,
      complexityScore: analysis.complexityScore,
      problems,
    })
  }

  return results
}

export function formatQualityResultRow(r: QualityResult): string {
  const problems = r.problems.length > 0 ? r.problems.join(', ') : 'none'
  return (
    `${r.label.padEnd(42)} ` +
    `${r.sourceDimensions.padEnd(9)} ` +
    `${r.conversionTimeMs.toFixed(1).padStart(7)}ms ` +
    `${String(r.svgSizeBytes).padStart(8)}B ` +
    `${String(r.pathCount).padStart(5)} paths ` +
    `${String(r.nodeCount).padStart(6)} nodes ` +
    `preset=${r.selectedPreset.padEnd(11)} ` +
    `problems=${problems}`
  )
}
