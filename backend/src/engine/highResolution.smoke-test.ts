// High-resolution and hairline regression tests for the tracing engine.
//
// 1. Hairlines: isolated thin strokes (0.5–1 px diagonals, a signature curve,
//    a circle) rendered small enough to be upscaled. They used to vanish
//    because the post-upscale blur averaged them into the background; the
//    ridge-preserving upscale must keep them (edge-length ratio near 1).
// 2. High resolution: detailed corpus artwork rendered at ~4 MP must be traced
//    at full resolution (no fractional downscale) with sub-half-pixel edges.
// See BENCHMARKS.md "High-resolution engine".
//
// Run with: npx tsx src/engine/highResolution.smoke-test.ts (from inside backend/)
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { traceImage } from './traceImage'
import { engineOptionsFor } from './profiles'
import { compareImages } from '../benchmark/metrics'
import { REAL_WORLD_CORPUS } from '../benchmark/realWorldCorpus'

const { Resvg } = createRequire(import.meta.url)('@resvg/resvg-js') as typeof import('@resvg/resvg-js')

function assertTrue(condition: boolean, message: string): void {
  if (!condition) throw new Error(message)
}

const render = (svg: string, width: number) => {
  const r = new Resvg(svg, { fitTo: { mode: 'width', value: width }, background: 'white', font: { loadSystemFonts: true, defaultFontFamily: 'DejaVu Sans' } }).render()
  return { px: new Uint8Array(r.pixels), width: r.width, height: r.height }
}

// --- 1. Hairlines -----------------------------------------------------------
const HAIRLINES: Record<string, string> = {
  'diagonal 0.5px': '<line x1="32" y1="300" x2="480" y2="166" stroke="#111827" stroke-width="1"/>',
  'diagonal 1px': '<line x1="32" y1="300" x2="480" y2="166" stroke="#111827" stroke-width="2"/>',
  'signature 0.75px': '<path d="M40 330 C 90 200, 140 420, 190 300 S 290 180, 330 320 S 420 400, 470 250" fill="none" stroke="#1d3a8a" stroke-width="1.5"/>',
  'circle 0.75px': '<circle cx="256" cy="256" r="180" fill="none" stroke="#111827" stroke-width="1.5"/>',
}
// Measured (both modes): edge-length ratio 0.82–0.96; before the fix 0.00–0.14.
const MIN_HAIRLINE_EDGE_RATIO = 0.7

for (const mode of ['quick', 'professional'] as const) {
  for (const [name, body] of Object.entries(HAIRLINES)) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512"><rect width="512" height="512" fill="#fff"/>${body}</svg>`
    // Rendered at 256 px: the strokes are 0.5–1 source pixels wide.
    const src = render(svg, 256)
    const out = traceImage({ width: src.width, height: src.height, data: new Uint8ClampedArray(src.px) }, { ...engineOptionsFor(mode), upscaleFilter: 'ridge' })
    assertTrue(out.stats.upscale > 1, `${mode} ${name}: expected the small input to be upscaled`)
    const truth = render(svg, 1024)
    const traced = render(out.svg, 1024)
    const d = compareImages(truth.px, traced.px, truth.width, truth.height, 4)
    assertTrue(
      d.edgeLengthRatio >= MIN_HAIRLINE_EDGE_RATIO,
      `${mode} ${name}: hairline lost (edge-length ratio ${d.edgeLengthRatio.toFixed(2)} < ${MIN_HAIRLINE_EDGE_RATIO})`,
    )
    console.log(`PASS: ${mode} hairline ${name}: edge-length ratio ${d.edgeLengthRatio.toFixed(2)}, ΔE ${d.meanDeltaE.toFixed(3)}`)
  }
}

// --- 2. 4 MP artwork at full resolution ------------------------------------
// Measured (Quick, 4 MP): logo-complex edge 0.24 px, ornament ~0.2 px; at the
// old 1.2 MP fractional working size both were ~0.6 px.
const HIGH_RES = [
  { id: 'logo-complex', maxEdge: 0.4 },
  { id: 'ornament', maxEdge: 0.4 },
]
const assets = join(dirname(fileURLToPath(import.meta.url)), '../benchmark/assets/')
for (const { id, maxEdge } of HIGH_RES) {
  const c = REAL_WORLD_CORPUS.find((x) => x.id === id)
  if (!c) throw new Error(`missing corpus case ${id}`)
  const svg = c.svg ?? readFileSync(`${assets}${c.svgFile}`, 'utf8')
  const probe = render(svg, 100)
  const width = Math.floor(Math.sqrt(4_000_000 / (probe.height / probe.width)))
  const truth = render(svg, width)
  const start = performance.now()
  const out = traceImage({ width: truth.width, height: truth.height, data: new Uint8ClampedArray(truth.px) }, { ...engineOptionsFor('quick'), sourceFormat: 'png' })
  const seconds = (performance.now() - start) / 1000
  assertTrue(
    out.stats.workingWidth === truth.width && out.stats.workingHeight === truth.height,
    `${id}: 4 MP artwork must be traced at full resolution (got ${out.stats.workingWidth}x${out.stats.workingHeight})`,
  )
  const d = compareImages(truth.px, render(out.svg, truth.width).px, truth.width, truth.height, 1)
  assertTrue(d.boundaryError <= maxEdge, `${id}: 4 MP edge error ${d.boundaryError.toFixed(2)} px > ${maxEdge}`)
  console.log(`PASS: ${id} at ${truth.width}x${truth.height}: edge ${d.boundaryError.toFixed(2)} px, ΔE ${d.meanDeltaE.toFixed(2)}, ${(out.svg.length / 1024).toFixed(1)} KB, ${seconds.toFixed(1)} s`)
}

console.log('\nAll high-resolution and hairline smoke tests passed.')
