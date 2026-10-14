// Customer emblem gate: the exact 640 px WebP a customer compared with
// Vectorizer.AI (assets/customer/, see customerEmblem.ts), traced through
// the production decode and both profiles and scored against the source
// raster. Fails if text, line art or the coat of arms regress towards the
// blotchy result that prompted the comparison, or if Professional stops
// beating Quick on it, at its own size and enlarged 3× (a large upload of the
// same design). See BENCHMARKS.md "Customer emblem" and "Region budget".
//
// Run with: npx tsx src/benchmark/customerEmblemGate.smoke-test.ts (from inside backend/)
import { decodeImage } from '../providers/imageDecoder'
import { loadDecoderWasmModules } from '../testSupport/wasmTestFixtures'
import { readFileSync } from '../testSupport/node-fs.js'
import { runTracePipeline, type TraceMode } from '../pipeline/ProfessionalTracePipeline'
import { sourceFormatFromMime } from '../engine/profiles'
import { upscaleBilinear } from '../engine/raster'
import { renderSvg } from './runBenchmark'
import { CUSTOMER_EMBLEM_FILE, CUSTOMER_EMBLEM_SIZE, VECTORIZER_AI_REFERENCE, scoreCustomerEmblem, type EmblemScore } from './customerEmblem'

function assertTrue(condition: boolean, message: string): void {
  if (!condition) throw new Error(message)
}

// Measured (Professional / Quick): ΔE 4.06 / 4.51, edge recall 0.952 / 0.947,
// precision 0.963 / 0.955, lines kept 0.953 / 0.926, 1,956 / 1,094 KB (with
// cheapest-first region budget merging; detail-first area passes: 4.21 / 4.61,
// 1,853 / 942 KB). Before the texture-detail round: Professional 5.13, 0.875,
// 0.952, 0.845, 2,018 KB; Quick 4.98, 0.917, 0.944, 0.883, 1,101 KB.
// Vectorizer.AI: 4.18, 0.941, 0.958, 0.978 lines kept.
const BUDGETS: Record<TraceMode, { deltaE: number; edgeRecall: number; edgePrecision: number; linesKept: number; maxKb: number }> = {
  quick: { deltaE: 4.75, edgeRecall: 0.92, edgePrecision: 0.94, linesKept: 0.9, maxKb: 1250 },
  professional: { deltaE: 4.35, edgeRecall: 0.93, edgePrecision: 0.945, linesKept: 0.93, maxKb: 2300 },
}

// The emblem enlarged 3× (1920 px, bilinear), as a large upload of the same
// design: traced at full resolution (emblem class) and over the region
// budget in both modes. Measured (Professional / Quick): ΔE 3.03 / 3.37,
// coat of arms 4.62 / 5.30 with edge recall 0.914 / 0.904, 3,907 / 3,601 KB.
// With area-pass budget merging Professional lost: 3.83 vs 3.59, coat of
// arms 6.56 / 0.832 (BENCHMARKS.md "Region budget").
const LARGE_FACTOR = 3
const LARGE_MAX_KB: Record<TraceMode, number> = { quick: 4300, professional: 4600 }

const fmt = (label: string, s: EmblemScore) =>
  `${label.padEnd(30)} ${[s.deltaE.toFixed(2), s.edgeRecall.toFixed(3), s.edgePrecision.toFixed(3), s.edgeLengthRatio.toFixed(3), s.linesKept.toFixed(3)].map((v) => v.padStart(9)).join(' ')}`

async function run(): Promise<void> {
  const bytes = await readFileSync(`src/benchmark/assets/${CUSTOMER_EMBLEM_FILE}`)
  const encoded = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
  const wasm = await loadDecoderWasmModules()
  const scores = {} as Record<TraceMode, Record<string, EmblemScore>>
  console.log(`${''.padEnd(30)} ${['ΔE×100', 'edge rec', 'edge prec', 'edge len', 'lines'].map((v) => v.padStart(9)).join(' ')}`)
  const large = {} as Record<TraceMode, Record<string, EmblemScore>>
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

    const enlarged = upscaleBilinear({ width: CUSTOMER_EMBLEM_SIZE, height: CUSTOMER_EMBLEM_SIZE, data: new Uint8ClampedArray(source) }, LARGE_FACTOR)
    const largeResult = runTracePipeline(enlarged as unknown as ImageData, mode, 'png')
    large[mode] = scoreCustomerEmblem(source, renderSvg(largeResult.svg, CUSTOMER_EMBLEM_SIZE * 2).pixels)
    const largeKb = largeResult.svg.length / 1024
    for (const region of ['all', 'coat-of-arms', 'text-top'] as const) console.log(fmt(`${mode} ${LARGE_FACTOR}× ${region}`, large[mode][region]!))
    console.log(`${mode} ${LARGE_FACTOR}×: ${largeKb.toFixed(0)} KB, ${largeResult.totalTimeMs.toFixed(0)} ms`)
    assertTrue(largeKb <= LARGE_MAX_KB[mode], `${mode} ${LARGE_FACTOR}×: SVG ${largeKb.toFixed(0)} KB exceeds ${LARGE_MAX_KB[mode]} KB`)
  }

  const quick = scores.quick
  const pro = scores.professional
  // Professional came out worse than Quick here (ΔE 5.13 vs 4.98): its 2×
  // upsampling blurred the 1 px letter and line-art strokes into gray, and
  // the gray stripes merged into blotches.
  assertTrue(pro.all!.deltaE < quick.all!.deltaE - 0.2, `professional ΔE ${pro.all!.deltaE.toFixed(2)} is not clearly better than Quick ${quick.all!.deltaE.toFixed(2)}`)
  assertTrue(pro.all!.linesKept > quick.all!.linesKept, `professional keeps fewer thin lines (${pro.all!.linesKept.toFixed(3)}) than Quick (${quick.all!.linesKept.toFixed(3)})`)
  // The line-art coat of arms (eagle, cotton, sun rays) was the worst region:
  // measured ΔE 6.86, edge recall 0.943 (before: 8.27, 0.775; Vectorizer.AI 6.30, 0.906).
  const arms = pro['coat-of-arms']!
  assertTrue(arms.deltaE <= 7.6 && arms.edgeRecall >= 0.9, `professional coat of arms ΔE ${arms.deltaE.toFixed(2)}, edge recall ${arms.edgeRecall.toFixed(3)} (budget 7.6, 0.9)`)
  // Circular serif text: measured lines kept 0.961 top, 0.945 bottom (before 0.900, 0.813).
  for (const region of ['text-top', 'text-bottom'] as const) {
    assertTrue(pro[region]!.linesKept >= 0.86, `professional ${region}: thin lines kept ${pro[region]!.linesKept.toFixed(3)} below 0.86 (letter strokes lost?)`)
  }
  console.log(`PASS: Professional ΔE ${pro.all!.deltaE.toFixed(2)} vs Quick ${quick.all!.deltaE.toFixed(2)} (Vectorizer.AI ${VECTORIZER_AI_REFERENCE.all!.deltaE.toFixed(2)})`)

  // Large upload: Professional's finer palette gives more regions, so it
  // reaches the region budget first; merging must spend the budget on
  // shading fragments, not on the coat of arms and the lettering.
  const largePro = large.professional
  const largeQuick = large.quick
  assertTrue(largePro.all!.deltaE < largeQuick.all!.deltaE - 0.2, `${LARGE_FACTOR}×: professional ΔE ${largePro.all!.deltaE.toFixed(2)} is not clearly better than Quick ${largeQuick.all!.deltaE.toFixed(2)}`)
  const largeArms = largePro['coat-of-arms']!
  assertTrue(largeArms.deltaE < largeQuick['coat-of-arms']!.deltaE && largeArms.edgeRecall >= 0.89, `${LARGE_FACTOR}×: professional coat of arms ΔE ${largeArms.deltaE.toFixed(2)}, edge recall ${largeArms.edgeRecall.toFixed(3)} (Quick ${largeQuick['coat-of-arms']!.deltaE.toFixed(2)}; budget 0.89)`)
  assertTrue(largePro['text-top']!.deltaE <= largeQuick['text-top']!.deltaE && largePro['text-top']!.linesKept >= 0.97, `${LARGE_FACTOR}×: professional top text ΔE ${largePro['text-top']!.deltaE.toFixed(2)}, lines kept ${largePro['text-top']!.linesKept.toFixed(3)} (Quick ${largeQuick['text-top']!.deltaE.toFixed(2)}; budget 0.97)`)
  console.log(`PASS: ${LARGE_FACTOR}× Professional ΔE ${largePro.all!.deltaE.toFixed(2)} vs Quick ${largeQuick.all!.deltaE.toFixed(2)}`)
  console.log('\nCustomer emblem gate passed.')
}

run().catch((error: unknown) => {
  console.error('Customer emblem gate failed:', error)
  throw error
})
