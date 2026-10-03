// Real-world quality gate: runs the 55-image real-world corpus
// (realWorldCorpus.ts: emoji, icons, logos, text, thin lines, JPEGs, blurred
// and low-resolution inputs, photos and scans) through both production
// profiles and fails if quality regresses past the recorded budgets, or if
// one of the specific failures fixed in the quality milestone comes back.
// See BENCHMARKS.md "Real-world corpus".
//
// Run with: npx tsx src/benchmark/realWorldGate.smoke-test.ts (from inside backend/)
import { runBenchmark, formatSummary, type BenchmarkRow } from './runBenchmark'

function assertTrue(condition: boolean, message: string): void {
  if (!condition) throw new Error(message)
}

// Budgets sit ~20% above the values measured in BENCHMARKS.md.
const BUDGETS = {
  // Measured: ΔE 0.71, edge 0.13 px, 4,767 KB in total.
  quick: { meanDeltaE: 0.85, meanEdgeError: 0.16, totalKb: 5700 },
  // Measured: ΔE 0.68, edge 0.13 px, 5,351 KB in total.
  professional: { meanDeltaE: 0.8, meanEdgeError: 0.16, totalKb: 6400 },
}

const mean = (rows: BenchmarkRow[], pick: (r: BenchmarkRow) => number) => rows.reduce((s, r) => s + pick(r), 0) / Math.max(1, rows.length)
const find = (rows: BenchmarkRow[], caseId: string, variant: string) => {
  const row = rows.find((r) => r.caseId === caseId && r.variant === variant)
  if (!row) throw new Error(`missing benchmark row ${caseId}@${variant}`)
  return row
}

async function run(): Promise<void> {
  const rows = await runBenchmark({ engines: ['professional', 'quick'], corpus: 'real' })
  console.log(formatSummary(rows))

  const byEngine = { quick: rows.filter((r) => r.engine === 'quick'), professional: rows.filter((r) => r.engine === 'professional') }
  for (const engine of ['quick', 'professional'] as const) {
    const mine = byEngine[engine]
    const budget = BUDGETS[engine]
    const vector = mine.filter((r) => r.reference === 'vector')
    for (const row of mine) assertTrue(!row.failed, `${engine}: ${row.caseId}@${row.variant} failed to trace`)
    const meanDeltaE = mean(mine, (r) => r.meanDeltaE)
    const meanEdge = mean(vector, (r) => r.boundaryError)
    const totalKb = mine.reduce((s, r) => s + r.bytes / 1024, 0)
    assertTrue(meanDeltaE <= budget.meanDeltaE, `${engine}: mean ΔE ${meanDeltaE.toFixed(3)} exceeds ${budget.meanDeltaE}`)
    assertTrue(meanEdge <= budget.meanEdgeError, `${engine}: mean edge error ${meanEdge.toFixed(3)} exceeds ${budget.meanEdgeError}`)
    assertTrue(totalKb <= budget.totalKb, `${engine}: ${totalKb.toFixed(0)} KB in total exceeds ${budget.totalKb}`)

    // Seams between neighbouring shapes (fixed by the same-color underlay;
    // before it, means were 6-9/10k and single images reached 40+).
    for (const row of vector) {
      assertTrue(row.gapsPer10k < 1.5, `${engine}: ${row.caseId}@${row.variant} has seams (${row.gapsPer10k.toFixed(1)}/10k)`)
    }
    // Hairlines vanished at labeling (fixed by coverage-preserving labeling):
    // thin-lines@256 kept 32% of its edge length before, ~95-105% now.
    const thin = find(mine, 'thin-lines', '256')
    assertTrue(thin.edgeLengthRatio >= 0.85, `${engine}: thin-lines@256 edge-length ratio ${thin.edgeLengthRatio.toFixed(2)} < 0.85 (hairlines lost)`)
    // ...and a shallow 0.75 px diagonal came out dashed (Quick 0.70 before the ridge rule, 0.49 after).
    assertTrue(thin.meanDeltaE <= 0.62, `${engine}: thin-lines@256 ΔE ${thin.meanDeltaE.toFixed(2)} exceeds 0.62`)
    // Small italic text: broken by a blend-tint palette color (1.03), then by
    // split-coverage stroke pixels (0.92); 0.85 now.
    const serif = find(mine, 'typo-serif', '512')
    assertTrue(serif.meanDeltaE <= 0.9, `${engine}: typo-serif@512 ΔE ${serif.meanDeltaE.toFixed(2)} exceeds 0.9`)
    // Quick merged a pale fill into the white background on a q40 JPEG logo
    // (ΔE 1.60) and on a blurred emoji (0.50); palette separation keeps them.
    const jpegLogo = find(mine, 'logo-complex', '512jpgq40')
    assertTrue(jpegLogo.meanDeltaE <= 0.6, `${engine}: logo-complex@512jpgq40 ΔE ${jpegLogo.meanDeltaE.toFixed(2)} exceeds 0.6 (pale fill merged?)`)
    const blurred = find(mine, 'emoji-fox', '256blur1.2')
    assertTrue(blurred.meanDeltaE <= 0.25, `${engine}: emoji-fox@256blur1.2 ΔE ${blurred.meanDeltaE.toFixed(2)} exceeds 0.25`)
    console.log(`PASS: ${engine} — mean ΔE ${meanDeltaE.toFixed(2)}, mean edge ${meanEdge.toFixed(2)}px, ${totalKb.toFixed(0)} KB, no failures or seams`)
  }

  // Professional's gradient fills once smeared photos (ΔE 6.2 vs Quick 3.5);
  // validated gradients must never make it meaningfully worse than Quick.
  for (const quick of byEngine.quick.filter((r) => r.category === 'photo' || r.category === 'scan')) {
    const pro = find(byEngine.professional, quick.caseId, quick.variant)
    assertTrue(
      pro.meanDeltaE <= quick.meanDeltaE * 1.05,
      `professional: ${quick.caseId} ΔE ${pro.meanDeltaE.toFixed(2)} is worse than Quick ${quick.meanDeltaE.toFixed(2)}`,
    )
  }
  console.log('\nReal-world quality gate passed.')
}

run().catch((error: unknown) => {
  console.error('Real-world quality gate failed:', error)
  throw error
})
