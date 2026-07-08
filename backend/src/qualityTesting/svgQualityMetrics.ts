/**
 * Proxy quality metrics computed from the traced SVG's own markup — this
 * environment has no way to render/eyeball an SVG, so "output quality" is
 * approximated from structural signals instead of a real visual diff. See
 * QUALITY_REPORT.md for the caveat this implies.
 */
export interface SvgQualityMetrics {
  pathCount: number
  svgSizeBytes: number
  totalPathDataBytes: number
  /** Quadratic-curve ("Q"/"q") commands as a fraction of all draw commands ("L"/"l"/"Q"/"q") — low values on a round source mean edges are being faceted into straight segments instead of traced smoothly. */
  curveCommandRatio: number
  averagePathDataBytes: number
}

function extractPathData(svg: string): string[] {
  const matches = svg.matchAll(/<path\b[^>]*\sd="([^"]*)"/g)
  return Array.from(matches, (m) => m[1] ?? '')
}

export function measureSvgQuality(svg: string): SvgQualityMetrics {
  const pathDataList = extractPathData(svg)
  const totalPathDataBytes = pathDataList.reduce((sum, d) => sum + d.length, 0)
  const lineCommands = pathDataList.reduce((sum, d) => sum + (d.match(/[Ll]/g)?.length ?? 0), 0)
  const curveCommands = pathDataList.reduce((sum, d) => sum + (d.match(/[Qq]/g)?.length ?? 0), 0)
  const totalCommands = lineCommands + curveCommands

  return {
    pathCount: pathDataList.length,
    svgSizeBytes: new TextEncoder().encode(svg).byteLength,
    totalPathDataBytes,
    curveCommandRatio: totalCommands > 0 ? curveCommands / totalCommands : 0,
    averagePathDataBytes: pathDataList.length > 0 ? totalPathDataBytes / pathDataList.length : 0,
  }
}

export type ProblemFlag = 'too-many-paths' | 'missing-details' | 'jagged-edges' | 'noisy-svg' | 'oversized-svg'

export interface QualityBudget {
  /** Categories whose source has a round/curved silhouette — used for the jagged-edges check. */
  hasCurvedSilhouette: boolean
  maxSvgBytes: number
  maxPathCount: number
}

export function detectProblems(metrics: SvgQualityMetrics, budget: QualityBudget): ProblemFlag[] {
  const problems: ProblemFlag[] = []

  if (metrics.pathCount > budget.maxPathCount) problems.push('too-many-paths')
  if (metrics.pathCount < 2) problems.push('missing-details')
  if (budget.hasCurvedSilhouette && metrics.curveCommandRatio < 0.15) problems.push('jagged-edges')
  // Many tiny path fragments (low average bytes/path at a non-trivial count)
  // is the structural signature of speckle noise rather than clean shapes.
  if (metrics.pathCount > 50 && metrics.averagePathDataBytes < 40) problems.push('noisy-svg')
  if (metrics.svgSizeBytes > budget.maxSvgBytes) problems.push('oversized-svg')

  return problems
}
