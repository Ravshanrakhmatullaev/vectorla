/**
 * Child-process helper for `runBenchmark --memory`: traces one raw RGBA image
 * and prints how much the process's peak resident memory (maxRSS) grew during
 * the trace. Run in a fresh process per trace so peaks do not accumulate.
 *
 *   npx tsx src/benchmark/memoryProbe.ts <file.rgba> <width> <height> <png|jpeg> <quick|professional>
 */
import { runProfessionalTrace, runQuickTrace } from '../pipeline/ProfessionalTracePipeline'
import { readFileSync } from '../testSupport/node-fs.js'

interface NodeProcess {
  argv: string[]
  resourceUsage(): { maxRSS: number }
}
const proc = (globalThis as unknown as { process: NodeProcess }).process

async function main(): Promise<void> {
  const [file, width, height, format, engine] = proc.argv.slice(2)
  const bytes = await readFileSync(file!)
  const image = { width: Number(width), height: Number(height), data: new Uint8ClampedArray(bytes.buffer, bytes.byteOffset, bytes.byteLength) } as ImageData
  const before = proc.resourceUsage().maxRSS
  const trace = engine === 'professional' ? runProfessionalTrace : runQuickTrace
  trace(image, format as 'png' | 'jpeg')
  const after = proc.resourceUsage().maxRSS
  console.log(`PEAK_MB=${((after - before) / 1024).toFixed(1)}`)
}

void main()
