// Local smoke test for the Vectorla tracing engine: correctness on simple
// shapes, robustness on degenerate inputs, and resource bounds.
//
// Run with: npx tsx src/engine/traceImage.smoke-test.ts (from inside backend/)
import { fitWorkingSize, traceImage } from './traceImage'
import { fitChain } from './curveFit'
import { extractChains, buildRegionBoundaries } from './planarMap'
import { measureSvgStructure } from '../benchmark/metrics'

function assertTrue(condition: boolean, message: string): void {
  if (!condition) throw new Error(message)
}
function assertEqual<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) throw new Error(`${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
}

function makeImage(w: number, h: number, fill: (x: number, y: number) => [number, number, number, number]) {
  const data = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data.set(fill(x, y), (y * w + x) * 4)
  return { width: w, height: h, data }
}

/** Anti-aliased disc via 4x4 supersampling. */
function disc(size: number, color: [number, number, number], background: [number, number, number, number]) {
  const c = size / 2
  const r = size * 0.35
  return makeImage(size, size, (x, y) => {
    let inside = 0
    for (let sy = 0; sy < 4; sy++) for (let sx = 0; sx < 4; sx++) if ((x + (sx + 0.5) / 4 - c) ** 2 + (y + (sy + 0.5) / 4 - c) ** 2 <= r * r) inside++
    const t = inside / 16
    if (background[3] === 0) return [...color, Math.round(255 * t)] as [number, number, number, number]
    return [
      Math.round(color[0] * t + background[0] * (1 - t)),
      Math.round(color[1] * t + background[1] * (1 - t)),
      Math.round(color[2] * t + background[2] * (1 - t)),
      255,
    ]
  })
}

function run(): void {
  // 1. An anti-aliased disc traces to exactly two colors (no AA halo ring)
  //    and a smooth curved outline.
  const aaDisc = traceImage(disc(96, [200, 30, 40], [255, 255, 255, 255]))
  assertEqual(aaDisc.stats.paletteSize, 2, 'AA disc: only the two real colors')
  assertEqual(aaDisc.stats.pathCount, 2, 'AA disc: background + disc, no fringe paths')
  assertTrue(aaDisc.svg.includes('#c81e28'), 'AA disc keeps its exact color')
  const discPath = aaDisc.svg.match(/<path fill="#c81e28" d="[^"]*"\/>/)?.[0] ?? ''
  const curves = measureSvgStructure(discPath).curves
  assertTrue(curves >= 3 && curves <= 12, `AA disc outline is a handful of smooth curves (got ${curves})`)
  console.log(`PASS: anti-aliased disc -> 2 colors, ${curves} curves, ${aaDisc.svg.length} bytes`)

  // 2. Transparency: a disc on a transparent background produces one path
  //    and no background shape.
  const transparent = traceImage(disc(96, [16, 185, 129], [0, 0, 0, 0]))
  assertEqual(transparent.stats.pathCount, 1, 'transparent background is not drawn')
  console.log('PASS: transparent background -> single shape')

  // 3. Sharp corners survive: an axis-aligned square traces to 4 straight lines.
  const square = traceImage(makeImage(64, 64, (x, y) => (x >= 16 && x < 48 && y >= 16 && y < 48 ? [0, 0, 0, 255] : [255, 255, 255, 255])))
  const squarePath = square.svg.match(/<path fill="#000" d="[^"]*"\/>/)?.[0] ?? ''
  // Exact geometry, sharp corners, and the minimal path (z closes the 4th side).
  // The start corner follows the polygon search (its 128-point outline
  // exceeds MAX_SEGMENT_POINTS, curveFit.ts), so only the corner set and
  // orientation are fixed: 48,16 -> 16,16 -> 16,48 -> 48,48.
  assertEqual(squarePath, '<path fill="#000" d="m48 16h-32v32h32z"/>', 'square traces to its exact minimal outline')
  console.log(`PASS: square -> straight edges only (${squarePath})`)

  // 4. Shared boundaries: two touching colors share one fitted chain, so the
  //    cutout output has no gaps (region count 2, chain count small).
  const halves = traceImage(makeImage(40, 20, (x) => (x < 20 ? [255, 0, 0, 255] : [0, 0, 255, 255])), { mode: 'cutout' })
  assertEqual(halves.stats.pathCount, 2, 'two halves -> two paths')
  console.log(`PASS: two touching regions -> ${halves.stats.chainCount} shared chains`)

  // 5. Degenerate inputs never throw.
  const degenerate = [
    makeImage(1, 1, () => [10, 20, 30, 255]),
    makeImage(3, 2, (x) => (x === 1 ? [0, 0, 0, 255] : [255, 255, 255, 255])),
    makeImage(50, 50, () => [0, 0, 0, 0]),
    makeImage(300, 1, (x) => (x % 2 ? [0, 0, 0, 255] : [255, 255, 255, 255])),
  ]
  for (const image of degenerate) {
    const result = traceImage(image)
    assertTrue(result.svg.startsWith('<svg') && result.svg.endsWith('</svg>'), `degenerate ${image.width}x${image.height} produces an SVG`)
  }
  console.log('PASS: degenerate inputs (1x1, tiny, fully transparent, 1px-tall stripes) produce valid SVGs')

  // 6. Region budget bounds pathological inputs (pure noise).
  let seed = 3
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff)
  const noise = traceImage(makeImage(400, 400, () => [rnd() * 255, rnd() * 255, rnd() * 255, 255]), { maxRegions: 3000 })
  assertTrue(noise.stats.regionCount <= 3000, `noise output is bounded (${noise.stats.regionCount} regions)`)
  console.log(`PASS: pure noise bounded to ${noise.stats.regionCount} regions, ${(noise.svg.length / 1024).toFixed(0)} KB`)

  // 7. Planar map invariants on a 3-color image: every region has an outer loop.
  const ids = new Int32Array([0, 0, 1, 1, 0, 2, 2, 1, 0, 2, 2, 1])
  const chains = extractChains(ids, 4, 3)
  const boundaries = buildRegionBoundaries(chains, 3)
  assertTrue(boundaries.every((b) => b.outer !== null), 'every region gets an outer boundary loop')
  for (const chain of chains) {
    const fitted = fitChain(chain.points, chain.closed, { alphaMax: 1, optTolerance: 0.2, cornerSnap: null })
    const last = fitted.segments[fitted.segments.length - 1]
    if (!chain.closed && last) {
      const p = chain.points
      assertEqual(last.x, p[p.length - 2], 'open chain fit ends exactly at its junction (x)')
      assertEqual(last.y, p[p.length - 1], 'open chain fit ends exactly at its junction (y)')
    }
  }
  console.log(`PASS: planar map -> ${chains.length} chains, all regions closed, open chains keep exact junction endpoints`)

  // 8. Gradients: a smooth linear ramp is reconstructed as one gradient
  //    fill (when enabled), and flat art never turns into gradients.
  const ramp = makeImage(160, 120, (x, y) =>
    x >= 20 && x < 140 && y >= 20 && y < 100
      ? [Math.round(40 + (x - 20) * 1.6), Math.round(80 + (x - 20) * 0.8), 220, 255]
      : [255, 255, 255, 255],
  )
  const flatRamp = traceImage(ramp)
  const gradientRamp = traceImage(ramp, { gradients: true })
  assertEqual(flatRamp.stats.gradientCount, 0, 'gradients are off by default (posterized bands)')
  assertTrue(flatRamp.stats.pathCount > 3, `posterized ramp is several bands (${flatRamp.stats.pathCount} paths)`)
  assertEqual(gradientRamp.stats.gradientCount, 1, 'ramp reconstructed as exactly one gradient')
  assertEqual(gradientRamp.stats.pathCount, 2, 'background + one gradient-filled shape')
  assertTrue(gradientRamp.svg.includes('<linearGradient') && gradientRamp.svg.includes('fill="url(#g0)"'), 'gradient fill is emitted and referenced')
  const flatWithGradients = traceImage(disc(96, [200, 30, 40], [255, 255, 255, 255]), { gradients: true })
  assertEqual(flatWithGradients.stats.gradientCount, 0, 'flat art never becomes a gradient')
  console.log(`PASS: linear ramp -> 1 gradient (${gradientRamp.svg.length} bytes vs ${flatRamp.svg.length} posterized); flat art unaffected`)

  // 9. Early downscale (decodeForTrace): tracing a pre-fitted image with
  //    sourceSize is byte-identical to tracing the full-resolution original.
  const big = makeImage(1400, 900, (x, y) =>
    (x - 500) ** 2 + (y - 450) ** 2 < 300 ** 2 ? [200, 40, 60, 255] : x > 1000 && y > 200 && y < 700 ? [30, 90, 200, 255] : [250, 250, 245, 255],
  )
  const fitOptions = { maxWorkingPixels: 300_000 }
  const direct = traceImage(big, fitOptions).svg
  const fitted = traceImage(fitWorkingSize(big, fitOptions.maxWorkingPixels), { ...fitOptions, sourceSize: { width: 1400, height: 900 } }).svg
  assertTrue(direct === fitted, 'pre-fitted trace with sourceSize is identical to the full-resolution trace')
  assertTrue(fitted.includes('width="1400" height="900"'), 'SVG keeps the original dimensions')
  console.log('PASS: fitWorkingSize + sourceSize is byte-identical and keeps the upload size')

  // 10. Palette separation: a pale tint on white (~0.05 OKLab apart, under
  //     Quick's merge distance) with compression-like noise stays two colors
  //     (the JPEG end-to-end case is gated in realWorldGate.smoke-test.ts).
  let noiseSeed = 11
  const jitter = () => ((noiseSeed = (noiseSeed * 1103515245 + 12345) & 0x7fffffff) % 5) - 2
  const pale = makeImage(240, 240, (x, y) => {
    const inside = (x - 120) ** 2 + (y - 120) ** 2 < 80 ** 2
    const base = inside ? [233, 240, 255] : [255, 255, 255]
    return [base[0]! + jitter(), base[1]! + jitter(), base[2]! + jitter(), 255] as [number, number, number, number]
  })
  const lightColors = (r: ReturnType<typeof traceImage>) => r.palette.filter((c) => c.r > 220 && c.g > 220 && c.b > 220).length
  const separated = traceImage(pale, { maxColors: 32, mergeDistance: 0.05 })
  const merged = traceImage(pale, { maxColors: 32, mergeDistance: 0.05, paletteSeparation: 0 })
  assertEqual(lightColors(merged), 1, 'without separation the tint merges into white (the bug)')
  assertEqual(lightColors(separated), 2, 'pale tint and white stay separate colors')
  console.log('PASS: pale tint on white kept as its own color under compression-like noise')

  console.log('\nAll tracing engine smoke tests passed.')
}

run()
