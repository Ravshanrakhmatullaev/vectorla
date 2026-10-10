// Emblem quality gate: runs the adversarial emblem corpus (emblemCorpus.ts:
// seals, crests, metal badges, engraved and stitched emblems, a state-emblem
// style wreath, an embossed seal; PNG and JPEG, 600-2000 px) through both
// production profiles and fails if quality regresses past the recorded
// budgets, if Professional stops being clearly better than Quick, or if one
// of the specific failures fixed in the emblem round comes back.
// See BENCHMARKS.md "Emblems".
//
// Run with: npx tsx src/benchmark/emblemGate.smoke-test.ts (from inside backend/)
import { runBenchmark, formatSummary, type BenchmarkRow } from './runBenchmark'

function assertTrue(condition: boolean, message: string): void {
  if (!condition) throw new Error(message)
}

// Budgets sit ~20% above the values measured in BENCHMARKS.md "Emblems".
const BUDGETS = {
  // Measured: ΔE 0.75, edge 0.22 px, 5,109 KB in total (before the emblem round: 0.93, 0.25 px, 4,969 KB).
  quick: { meanDeltaE: 0.9, meanEdgeError: 0.28, totalKb: 6500 },
  // Measured: ΔE 0.48, edge 0.22 px, 4,473 KB in total (before the emblem round: 0.66, 0.26 px, 5,161 KB).
  professional: { meanDeltaE: 0.6, meanEdgeError: 0.28, totalKb: 5700 },
}

// Professional must stay clearly ahead of Quick on emblems (measured: 0.65×;
// before this round 0.71×, with the two differing on under 1% of pixels).
const PROFESSIONAL_TO_QUICK_MAX = 0.8

const mean = (rows: BenchmarkRow[], pick: (r: BenchmarkRow) => number) => rows.reduce((s, r) => s + pick(r), 0) / Math.max(1, rows.length)
const find = (rows: BenchmarkRow[], caseId: string, variant: string) => {
  const row = rows.find((r) => r.caseId === caseId && r.variant === variant)
  if (!row) throw new Error(`missing benchmark row ${caseId}@${variant}`)
  return row
}

async function run(): Promise<void> {
  const rows = await runBenchmark({ engines: ['professional', 'quick'], corpus: 'emblem' })
  console.log(formatSummary(rows))

  const byEngine = { quick: rows.filter((r) => r.engine === 'quick'), professional: rows.filter((r) => r.engine === 'professional') }
  for (const engine of ['quick', 'professional'] as const) {
    const mine = byEngine[engine]
    const budget = BUDGETS[engine]
    for (const row of mine) assertTrue(!row.failed, `${engine}: ${row.caseId}@${row.variant} failed to trace`)
    const meanDeltaE = mean(mine, (r) => r.meanDeltaE)
    const meanEdge = mean(mine, (r) => r.boundaryError)
    const totalKb = mine.reduce((s, r) => s + r.bytes / 1024, 0)
    assertTrue(meanDeltaE <= budget.meanDeltaE, `${engine}: mean ΔE ${meanDeltaE.toFixed(3)} exceeds ${budget.meanDeltaE}`)
    assertTrue(meanEdge <= budget.meanEdgeError, `${engine}: mean edge error ${meanEdge.toFixed(3)} exceeds ${budget.meanEdgeError}`)
    assertTrue(totalKb <= budget.totalKb, `${engine}: ${totalKb.toFixed(0)} KB in total exceeds ${budget.totalKb}`)
    for (const row of mine) {
      assertTrue(row.gapsPer10k < 1.5, `${engine}: ${row.caseId}@${row.variant} has seams (${row.gapsPer10k.toFixed(1)}/10k)`)
    }
    // Greedy palette seeding absorbed the cream inner disk into the white
    // background (Quick ΔE 1.15-1.38); flat inks now seed their own cluster.
    for (const variant of ['600', '1200', '2000']) {
      const seal = find(mine, 'seal-circular', variant)
      assertTrue(seal.meanDeltaE <= 0.5, `${engine}: seal-circular@${variant} ΔE ${seal.meanDeltaE.toFixed(2)} exceeds 0.5 (pale ink merged into white?)`)
    }
    console.log(`PASS: ${engine} — mean ΔE ${meanDeltaE.toFixed(2)}, mean edge ${meanEdge.toFixed(2)}px, ${totalKb.toFixed(0)} KB, no failures or seams`)
  }

  const quickDeltaE = mean(byEngine.quick, (r) => r.meanDeltaE)
  const proDeltaE = mean(byEngine.professional, (r) => r.meanDeltaE)
  assertTrue(
    proDeltaE <= quickDeltaE * PROFESSIONAL_TO_QUICK_MAX,
    `professional: mean ΔE ${proDeltaE.toFixed(3)} is not clearly better than Quick ${quickDeltaE.toFixed(3)} (limit ${PROFESSIONAL_TO_QUICK_MAX}×)`,
  )
  // Off-center radial fills (a metal badge's disk, a crest's fields) came out
  // as coarse concentric bands: the radial center was the bands' centroid.
  const badge = find(byEngine.professional, 'badge-metal', '1200')
  // Measured 0.49 (1.06 before).
  assertTrue(badge.meanDeltaE <= 0.65, `professional: badge-metal@1200 ΔE ${badge.meanDeltaE.toFixed(2)} exceeds 0.65 (radial gradients lost?)`)
  // A textured 1200² seal was halved by the photo cap and upsampled back to
  // the same working size (ΔE 1.31); it is now traced at full size (0.87).
  const embossed = find(byEngine.professional, 'seal-embossed', '1200')
  assertTrue(embossed.meanDeltaE <= 1.05, `professional: seal-embossed@1200 ΔE ${embossed.meanDeltaE.toFixed(2)} exceeds 1.05 (photo cap halving it again?)`)
  console.log(`PASS: Professional ΔE ${proDeltaE.toFixed(2)} vs Quick ${quickDeltaE.toFixed(2)} (${(proDeltaE / quickDeltaE).toFixed(2)}×)`)
  console.log('\nEmblem quality gate passed.')
}

run().catch((error: unknown) => {
  console.error('Emblem quality gate failed:', error)
  throw error
})
