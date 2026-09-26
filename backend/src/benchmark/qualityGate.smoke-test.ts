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
  // Measured (BENCHMARKS.md): ΔE 0.26, edge 0.17 px mean / 0.42 px worst, 6,895 segments.
  professional: { meanDeltaE: 0.34, meanEdgeError: 0.22, maxEdgeError: 0.5, totalSegments: 8600 },
  // Measured (BENCHMARKS.md): ΔE 0.26, edge 0.16 px mean / 0.37 px worst, 5,951 segments.
  quick: { meanDeltaE: 0.34, meanEdgeError: 0.21, maxEdgeError: 0.5, totalSegments: 7500 },
}

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
        assertTrue(
          row.meanDeltaE <= legacy.meanDeltaE * 1.05,
          `${engine}: ${row.caseId}@${row.variant} ΔE ${row.meanDeltaE.toFixed(2)} is worse than legacy ${legacy.meanDeltaE.toFixed(2)}`,
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
