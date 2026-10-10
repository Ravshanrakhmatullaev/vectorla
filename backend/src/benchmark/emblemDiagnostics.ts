/**
 * Per-stage diagnostics for the emblem corpus (Node only):
 *   npx tsx src/benchmark/emblemDiagnostics.ts [--cases=a,b] [--variants=600,1200]
 * Prints, per trace: palette size, regions after speckle cleanup and in the
 * output, region-budget passes, gradients found and kept, regions refined by
 * shading refinement, photo cap, time.
 */
import { prepareSources } from './runBenchmark'
import { traceImage } from '../engine/traceImage'
import { engineOptionsFor } from '../engine/profiles'

const argv = (globalThis as unknown as { process: { argv: string[] } }).process.argv
const arg = (k: string) => argv.find((a) => a.startsWith(`--${k}=`))?.split('=')[1]
const cases = arg('cases')?.split(',')
const variants = arg('variants')?.split(',')

const sources = await prepareSources({ corpus: 'emblem', cases })
console.log('| case | variant | mode | flat | photoCap | upscale | palette | afterSpeckle | budget passes (area) | regions | grad found/kept | shaded | paths | ms |')
console.log('|---|---|---|---:|---|---:|---:|---:|---|---:|---|---:|---:|---:|')
for (const s of sources) {
  if (variants && !variants.includes(s.variant)) continue
  for (const mode of ['quick', 'professional'] as const) {
    const t0 = performance.now()
    const r = traceImage(s.decoded, { ...engineOptionsFor(mode), sourceFormat: s.format })
    const ms = performance.now() - t0
    const d = r.stats.diagnostics
    console.log(`| ${s.caseId} | ${s.variant} | ${mode} | ${d.flatFraction.toFixed(2)} | ${d.photoCap ? 'yes' : 'no'} | ${r.stats.upscale} | ${r.stats.paletteSize} | ${d.regionsAfterSpeckle} | ${d.budgetPasses} (${d.budgetArea}) | ${r.stats.regionCount} | ${d.gradientGroupsFound}/${r.stats.gradientCount} | ${d.shadedRegions} | ${r.stats.pathCount} | ${ms.toFixed(0)} |`)
  }
}
