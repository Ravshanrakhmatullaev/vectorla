// Phase 23 quality-testing harness — runs the real PlaceholderProvider
// pipeline (decode -> analyze -> ImageTracer -> optimize) against one
// synthetic stand-in per real-world upload category (see
// testSupport/qualityTestImages.ts), measures processing time / SVG size /
// path count / detected preset, flags common problems via
// svgQualityMetrics.ts, and prints a report. No wrangler dev needed — same
// on-disk wasm loading as the existing smoke tests.
//
// Run with: npx tsx src/qualityTesting/runQualityHarness.ts (from inside backend/)
import { PlaceholderProvider } from '../providers/PlaceholderProvider'
import { loadDecoderWasmModules } from '../testSupport/wasmTestFixtures'
import { encodeTestPng, encodeTestJpeg } from '../testSupport/rasterEncode'
import { buildQualityTestImages, type QualityTestImage } from '../testSupport/qualityTestImages'
import { measureSvgQuality, detectProblems, type QualityBudget, type ProblemFlag } from './svgQualityMetrics'
import type { Upload } from '../types'

// Heuristic, category-specific acceptance budgets — there's no way to
// visually eyeball output in this environment, so these encode what "good
// enough for a print-ready vector" should structurally look like per
// category. See QUALITY_REPORT.md for the caveat this implies.
const BUDGETS: Record<string, QualityBudget> = {
  'simple-logo': { hasCurvedSilhouette: true, maxSvgBytes: 15_000, maxPathCount: 30 },
  'monochrome-logo': { hasCurvedSilhouette: false, maxSvgBytes: 15_000, maxPathCount: 20 },
  'colorful-logo': { hasCurvedSilhouette: true, maxSvgBytes: 40_000, maxPathCount: 60 },
  gradient: { hasCurvedSilhouette: false, maxSvgBytes: 150_000, maxPathCount: 800 },
  mascot: { hasCurvedSilhouette: true, maxSvgBytes: 60_000, maxPathCount: 100 },
  sticker: { hasCurvedSilhouette: true, maxSvgBytes: 30_000, maxPathCount: 50 },
  icon: { hasCurvedSilhouette: true, maxSvgBytes: 8_000, maxPathCount: 15 },
  'low-res-logo': { hasCurvedSilhouette: true, maxSvgBytes: 8_000, maxPathCount: 20 },
  'transparent-png': { hasCurvedSilhouette: true, maxSvgBytes: 60_000, maxPathCount: 150 },
  'jpeg-photo': { hasCurvedSilhouette: false, maxSvgBytes: 250_000, maxPathCount: 2000 },
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
  curveCommandRatio: number
  detectedPreset: string
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
  const images = buildQualityTestImages()
  const results: QualityResult[] = []

  for (const image of images) {
    const bytes = image.mimeType === 'image/jpeg' ? await encodeTestJpeg(image.imageData) : await encodeTestPng(image.imageData)
    const upload = makeUpload(image)

    const { analysis } = await provider.analyze(upload, bytes)

    const start = performance.now()
    const result = await provider.vectorize(upload, bytes, null)
    const conversionTimeMs = performance.now() - start

    const svg = new TextDecoder().decode(result.data)
    const metrics = measureSvgQuality(svg)
    const budget = BUDGETS[image.id]
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
      curveCommandRatio: metrics.curveCommandRatio,
      detectedPreset: analysis.recommendedPreset,
      colorCountEstimate: analysis.colorCountEstimate,
      complexityScore: analysis.complexityScore,
      problems,
    })
  }

  return results
}

function formatRow(r: QualityResult): string {
  const problems = r.problems.length > 0 ? r.problems.join(', ') : 'none'
  return (
    `${r.label.padEnd(38)} ` +
    `${r.sourceDimensions.padEnd(9)} ` +
    `${r.conversionTimeMs.toFixed(1).padStart(7)}ms ` +
    `${String(r.svgSizeBytes).padStart(8)}B ` +
    `${String(r.pathCount).padStart(5)} paths ` +
    `preset=${r.detectedPreset.padEnd(12)} ` +
    `problems=${problems}`
  )
}

async function main() {
  console.log('Phase 23 quality harness — synthetic real-world-category images through the real PlaceholderProvider pipeline\n')
  const results = await runQualityHarness()
  for (const r of results) console.log(formatRow(r))

  const withProblems = results.filter((r) => r.problems.length > 0)
  console.log(`\n${results.length} images tested, ${withProblems.length} with at least one flagged problem.`)
}

main().catch((error: unknown) => {
  console.error('Quality harness failed:', error)
  throw error
})
