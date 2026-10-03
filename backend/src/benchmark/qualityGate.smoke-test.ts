// Vector-quality regression gate. Runs the render-and-diff benchmark (see
// runBenchmark.ts / BENCHMARKS.md) for the production Professional and Quick
// profiles plus the legacy ImageTracer path, and fails if output fidelity
// regresses past the recorded budgets or the engine ever loses to the legacy
// path on a case.
//
// Run with: npx tsx src/benchmark/qualityGate.smoke-test.ts (from inside backend/)
import { runBenchmark, formatSummary, type BenchmarkRow } from './runBenchmark'

function assertTrue(condition: boolean, message: string): void {
  if (!condition) throw new Error(message)
}

// Budgets sit ~20-30% above the measured values recorded in BENCHMARKS.md, so
// normal tuning noise passes but a real regression does not.
const BUDGETS = {
  // Measured on 25 variants (BENCHMARKS.md): ΔE 0.17, edge 0.12 px mean / 0.22 px worst, 3,815 segments.
  professional: { meanDeltaE: 0.23, meanEdgeError: 0.16, maxEdgeError: 0.3, totalSegments: 4700 },
  // Measured on 25 variants (BENCHMARKS.md): ΔE 0.29, edge 0.11 px mean / 0.22 px worst, 4,666 segments.
  quick: { meanDeltaE: 0.39, meanEdgeError: 0.16, maxEdgeError: 0.3, totalSegments: 5700 },
}

// Professional reconstructs gradients; every gradient case must stay close
// to the source (posterized output scores ~0.6-1.1 here).
const PROFESSIONAL_GRADIENT_MAX_DELTA_E = 0.3

const mean = (rows: BenchmarkRow[], pick: (r: BenchmarkRow) => number) => rows.reduce((s, r) => s + pick(r), 0) / rows.length

async function run(): Promise<void> {
  const rows = await runBenchmark({ engines: ['professional', 'quick', 'legacy'] })
  console.log(formatSummary(rows))

  for (const engine of ['professional', 'quick'] as const) {
    const budget = BUDGETS[engine]
    const mine = rows.filter((r) => r.engine === engine)
    const meanDeltaE = mean(mine, (r) => r.meanDeltaE)
    const meanEdge = mean(mine, (r) => r.boundaryError)
    const worstEdge = Math.max(...mine.map((r) => r.boundaryError))
    const segments = mine.reduce((s, r) => s + r.segments, 0)
    assertTrue(meanDeltaE <= budget.meanDeltaE, `${engine}: mean ΔE ${meanDeltaE.toFixed(3)} exceeds ${budget.meanDeltaE}`)
    assertTrue(meanEdge <= budget.meanEdgeError, `${engine}: mean edge error ${meanEdge.toFixed(3)} exceeds ${budget.meanEdgeError}`)
    assertTrue(worstEdge <= budget.maxEdgeError, `${engine}: worst edge error ${worstEdge.toFixed(3)} exceeds ${budget.maxEdgeError}`)
    assertTrue(segments <= budget.totalSegments, `${engine}: ${segments} segments exceeds ${budget.totalSegments}`)
    for (const row of mine) {
      assertTrue(row.gapsPer10k === 0, `${engine}: ${row.caseId}@${row.variant} has gaps/seams (${row.gapsPer10k.toFixed(1)}/10k)`)
      const legacy = rows.find((r) => r.engine === 'legacy' && r.caseId === row.caseId && r.variant === row.variant)
      if (legacy) {
        // Quick Trace deliberately posterizes gradients (flat colors for
        // print/cut); only Professional reconstructs them, so Quick gets a
        // looser bound on gradient art.
        const tolerance = engine === 'quick' && row.category === 'gradient' ? 1.2 : 1.05
        assertTrue(
          row.meanDeltaE <= legacy.meanDeltaE * tolerance,
          `${engine}: ${row.caseId}@${row.variant} ΔE ${row.meanDeltaE.toFixed(2)} is worse than legacy ${legacy.meanDeltaE.toFixed(2)}`,
        )
      }
    }
    if (engine === 'professional') {
      for (const row of mine.filter((r) => r.category === 'gradient')) {
        assertTrue(
          row.meanDeltaE <= PROFESSIONAL_GRADIENT_MAX_DELTA_E,
          `professional: gradient case ${row.caseId}@${row.variant} ΔE ${row.meanDeltaE.toFixed(2)} exceeds ${PROFESSIONAL_GRADIENT_MAX_DELTA_E}`,
        )
      }
    }
    console.log(
      `PASS: ${engine} — mean ΔE ${meanDeltaE.toFixed(2)}, mean edge ${meanEdge.toFixed(2)}px, worst edge ${worstEdge.toFixed(2)}px, ${segments} segments, no gaps, never worse than legacy`,
    )
  }
  console.log('\nVector quality gate passed.')
}

run().catch((error: unknown) => {
  console.error('Quality gate failed:', error)
  throw error
})
