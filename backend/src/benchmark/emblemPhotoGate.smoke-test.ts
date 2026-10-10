// Photo-like emblem gate: the emblem designs as a photographed, scanned or
// re-rendered upload arrives (blur, sensor-like noise, JPEG; corpus
// 'emblem-photo', emblemCorpus.ts), at 2000 px, where the content class
// decides the working size. Shaded, compressed emblems are photo-like by flat
// fraction, but must be classified as emblems and traced at full resolution
// instead of the 1.2 MP photo cap, which lost their lettering and line art.
// See BENCHMARKS.md "Content classes".
//
// Run with: npx tsx src/benchmark/emblemPhotoGate.smoke-test.ts (from inside backend/)
import { runBenchmark, prepareSources, formatTable, type BenchmarkRow } from './runBenchmark'
import { classifyContent, workingPixelCap } from '../engine/traceImage'
import { engineOptionsFor, workingCaps } from '../engine/profiles'

function assertTrue(condition: boolean, message: string): void {
  if (!condition) throw new Error(message)
}

const VARIANTS = ['2000jpgq90blur0.7n7']

// Measured: Professional ΔE 0.75, Quick 0.97 (with the photo cap, before the
// emblem class: 0.91 and 1.17; text edge recall 0.95 -> 0.98).
const BUDGETS = { professional: 0.85, quick: 1.08 }

const mean = (rows: BenchmarkRow[], pick: (r: BenchmarkRow) => number) => rows.reduce((s, r) => s + pick(r), 0) / Math.max(1, rows.length)

async function run(): Promise<void> {
  for (const source of await prepareSources({ corpus: 'emblem-photo', variants: VARIANTS })) {
    const image = { width: source.decoded.width, height: source.decoded.height, data: source.decoded.data }
    const cls = classifyContent(image)
    assertTrue(cls === 'emblem', `${source.caseId}@${source.variant} classified as ${cls}`)
    for (const mode of ['quick', 'professional'] as const) {
      const caps = workingCaps(engineOptionsFor(mode))
      assertTrue(workingPixelCap(image, caps) === caps.maxWorkingPixels, `${mode}: ${source.caseId}@${source.variant} gets the photo cap`)
    }
  }
  console.log('PASS: every 2000 px photo-like emblem is an emblem and keeps full resolution')

  const rows = await runBenchmark({ engines: ['professional', 'quick'], corpus: 'emblem-photo', variants: VARIANTS })
  console.log(formatTable(rows))
  for (const engine of ['quick', 'professional'] as const) {
    const mine = rows.filter((r) => r.engine === engine)
    for (const row of mine) assertTrue(!row.failed, `${engine}: ${row.caseId}@${row.variant} failed to trace`)
    for (const row of mine) assertTrue(row.gapsPer10k < 1.5, `${engine}: ${row.caseId}@${row.variant} has seams (${row.gapsPer10k.toFixed(1)}/10k)`)
    const deltaE = mean(mine, (r) => r.meanDeltaE)
    assertTrue(deltaE <= BUDGETS[engine], `${engine}: mean ΔE ${deltaE.toFixed(3)} exceeds ${BUDGETS[engine]} (photo cap back?)`)
    console.log(`PASS: ${engine} mean ΔE ${deltaE.toFixed(2)} <= ${BUDGETS[engine]}`)
  }
  const pro = mean(rows.filter((r) => r.engine === 'professional'), (r) => r.meanDeltaE)
  const quick = mean(rows.filter((r) => r.engine === 'quick'), (r) => r.meanDeltaE)
  assertTrue(pro < quick, `professional ΔE ${pro.toFixed(3)} is not below Quick ${quick.toFixed(3)}`)
  console.log(`PASS: Professional ΔE ${pro.toFixed(2)} vs Quick ${quick.toFixed(2)}`)
  console.log('\nPhoto-like emblem gate passed.')
}

run().catch((error: unknown) => {
  console.error('Photo-like emblem gate failed:', error)
  throw error
})
