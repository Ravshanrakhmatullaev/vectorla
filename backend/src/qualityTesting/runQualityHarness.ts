// CLI entry point for the quality-testing harness — see qualityHarness.ts
// for the actual logic (kept separate so tracePresets.smoke-test.ts can
// import runQualityHarness() as a reusable assertion without also
// triggering this file's print-and-exit behavior).
//
// Run with: npx tsx src/qualityTesting/runQualityHarness.ts (from inside backend/)
import { runQualityHarness, formatQualityResultRow } from './qualityHarness'

async function main() {
  console.log('Quality harness — synthetic real-world-category images through the real analyze -> select -> trace pipeline\n')
  const results = await runQualityHarness()
  for (const r of results) console.log(formatQualityResultRow(r))

  const withProblems = results.filter((r) => r.problems.length > 0)
  console.log(`\n${results.length} images tested, ${withProblems.length} with at least one flagged problem.`)
}

main().catch((error: unknown) => {
  console.error('Quality harness failed:', error)
  throw error
})
