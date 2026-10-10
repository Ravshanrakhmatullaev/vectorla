// Customer emblem gate: the exact 640 px WebP a customer compared with
// Vectorizer.AI (assets/customer/, see customerEmblem.ts), traced through
// the production decode and both profiles and scored against the source
// raster. Fails if text, line art or the coat of arms regress towards the
// blotchy result that prompted the comparison, or if Professional stops
// beating Quick on it. See BENCHMARKS.md "Customer emblem".
//
// Run with: npx tsx src/benchmark/customerEmblemGate.smoke-test.ts (from inside backend/)
import { decodeImage } from '../providers/imageDecoder'
import { loadDecoderWasmModules } from '../testSupport/wasmTestFixtures'
import { readFileSync } from '../testSupport/node-fs.js'
import { runTracePipeline, type TraceMode } from '../pipeline/ProfessionalTracePipeline'
import { sourceFormatFromMime } from '../engine/profiles'
import { renderSvg } from './runBenchmark'
import { CUSTOMER_EMBLEM_FILE, CUSTOMER_EMBLEM_SIZE, VECTORIZER_AI_REFERENCE, scoreCustomerEmblem, type EmblemScore } from './customerEmblem'

function assertTrue(condition: boolean, message: string): void {
  if (!condition) throw new Error(message)
}

// Measured (Professional / Quick): ΔE 4.27 / 4.68, edge recall 0.943 / 0.927,
// precision 0.960 / 0.954, lines kept 0.935 / 0.911, 1,916 / 886 KB. Before
// the texture-detail round: Professional 5.13, 0.875, 0.952, 0.845, 2,018 KB;
// Quick 4.98, 0.917, 0.944, 0.883, 1,101 KB. Vectorizer.AI: 4.18, 0.941,
// 0.958, 0.978 lines kept.
const BUDGETS: Record<TraceMode, { deltaE: number; edgeRecall: number; edgePrecision: number; linesKept: number; maxKb: number }> = {
  quick: { deltaE: 4.85, edgeRecall: 0.91, edgePrecision: 0.94, linesKept: 0.89, maxKb: 1100 },
  professional: { deltaE: 4.5, edgeRecall: 0.93, edgePrecision: 0.945, linesKept: 0.92, maxKb: 2300 },
}

const fmt = (label: string, s: EmblemScore) =>
  `${label.padEnd(30)} ${[s.deltaE.toFixed(2), s.edgeRecall.toFixed(3), s.edgePrecision.toFixed(3), s.edgeLengthRatio.toFixed(3), s.linesKept.toFixed(3)].map((v) => v.padStart(9)).join(' ')}`

async function run(): Promise<void> {
  const bytes = await readFileSync(`src/benchmark/assets/${CUSTOMER_EMBLEM_FILE}`)
  const encoded = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
  const wasm = await loadDecoderWasmModules()
  const scores = {} as Record<TraceMode, Record<string, EmblemScore>>
  console.log(`${''.padEnd(30)} ${['ΔE×100', 'edge rec', 'edge prec', 'edge len', 'lines'].map((v) => v.padStart(9)).join(' ')}`)
  for (const mode of ['quick', 'professional'] as const) {
    // Decoded per run: the pipeline may scale the image it is handed in place.
    const decoded = await decodeImage('image/webp', encoded.slice(0), wasm)
    assertTrue(decoded.width === CUSTOMER_EMBLEM_SIZE && decoded.height === CUSTOMER_EMBLEM_SIZE, `unexpected size ${decoded.width}x${decoded.height}`)
    const source = new Uint8ClampedArray(decoded.data)
    const result = runTracePipeline(decoded as unknown as ImageData, mode, sourceFormatFromMime('image/webp'))
    const rendered = renderSvg(result.svg, CUSTOMER_EMBLEM_SIZE * 2)
    scores[mode] = scoreCustomerEmblem(source, rendered.pixels)
    const kb = result.svg.length / 1024
    for (const [region, s] of Object.entries(scores[mode])) {
      console.log(fmt(`${mode} ${region}`, s))
      if (region === 'all' || region === 'coat-of-arms' || region === 'text-top') console.log(fmt(`  Vectorizer.AI ${region}`, VECTORIZER_AI_REFERENCE[region]!))
    }
    console.log(`${mode}: ${kb.toFixed(0)} KB, ${(result.svg.match(/<path /g) ?? []).length} paths, ${result.totalTimeMs.toFixed(0)} ms`)

    const all = scores[mode].all!
    const budget = BUDGETS[mode]
    assertTrue(all.deltaE <= budget.deltaE, `${mode}: ΔE ${all.deltaE.toFixed(2)} exceeds ${budget.deltaE}`)
    assertTrue(all.edgeRecall >= budget.edgeRecall, `${mode}: edge recall ${all.edgeRecall.toFixed(3)} below ${budget.edgeRecall} (lines lost?)`)
    assertTrue(all.edgePrecision >= budget.edgePrecision, `${mode}: edge precision ${all.edgePrecision.toFixed(3)} below ${budget.edgePrecision} (speckle?)`)
    assertTrue(all.linesKept >= budget.linesKept, `${mode}: thin lines kept ${all.linesKept.toFixed(3)} below ${budget.linesKept}`)
    assertTrue(kb <= budget.maxKb, `${mode}: SVG ${kb.toFixed(0)} KB exceeds ${budget.maxKb} KB`)
    console.log(`PASS: ${mode}`)
  }

  const quick = scores.quick
  const pro = scores.professional
  // Professional came out worse than Quick here (ΔE 5.13 vs 4.98): its 2×
  // upsampling blurred the 1 px letter and line-art strokes into gray, and
  // the gray stripes merged into blotches.
  assertTrue(pro.all!.deltaE < quick.all!.deltaE - 0.2, `professional ΔE ${pro.all!.deltaE.toFixed(2)} is not clearly better than Quick ${quick.all!.deltaE.toFixed(2)}`)
  assertTrue(pro.all!.linesKept > quick.all!.linesKept, `professional keeps fewer thin lines (${pro.all!.linesKept.toFixed(3)}) than Quick (${quick.all!.linesKept.toFixed(3)})`)
  // The line-art coat of arms (eagle, cotton, sun rays) was the worst region:
  // measured ΔE 7.10, edge recall 0.946 (before: 8.27, 0.775; Vectorizer.AI 6.30, 0.906).
  const arms = pro['coat-of-arms']!
  assertTrue(arms.deltaE <= 7.6 && arms.edgeRecall >= 0.9, `professional coat of arms ΔE ${arms.deltaE.toFixed(2)}, edge recall ${arms.edgeRecall.toFixed(3)} (budget 7.6, 0.9)`)
  // Circular serif text: measured lines kept 0.957 top, 0.896 bottom (before 0.900, 0.813).
  for (const region of ['text-top', 'text-bottom'] as const) {
    assertTrue(pro[region]!.linesKept >= 0.86, `professional ${region}: thin lines kept ${pro[region]!.linesKept.toFixed(3)} below 0.86 (letter strokes lost?)`)
  }
  console.log(`PASS: Professional ΔE ${pro.all!.deltaE.toFixed(2)} vs Quick ${quick.all!.deltaE.toFixed(2)} (Vectorizer.AI ${VECTORIZER_AI_REFERENCE.all!.deltaE.toFixed(2)})`)
  console.log('\nCustomer emblem gate passed.')
}

run().catch((error: unknown) => {
  console.error('Customer emblem gate failed:', error)
  throw error
})
