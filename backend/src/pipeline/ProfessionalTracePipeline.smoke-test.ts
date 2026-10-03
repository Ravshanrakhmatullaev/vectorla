// Local smoke test for Quick/Professional Trace on the Vectorla engine.
//
// Run with: npx tsx src/pipeline/ProfessionalTracePipeline.smoke-test.ts (from inside backend/)
import { runTracePipeline, runProfessionalTrace, runQuickTrace } from './ProfessionalTracePipeline'

function assertEqual<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
  }
}

function assertTrue(condition: boolean, message: string): void {
  if (!condition) throw new Error(message)
}

function makeImageData(width: number, height: number, fill: (x: number, y: number) => [number, number, number, number]): ImageData {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      data.set(fill(x, y), (y * width + x) * 4)
    }
  }
  return { width, height, data } as ImageData
}

// A flat mark with salt-and-pepper noise sprinkled in.
function makeNoisyMark(): ImageData {
  let seed = 7
  const rng = () => {
    seed = (seed * 48271) % 2147483647
    return seed / 2147483647
  }
  return makeImageData(64, 64, (x, y) => {
    const inSquare = x >= 20 && x < 44 && y >= 20 && y < 44
    const [r, g, b] = inSquare ? [30, 60, 200] : [250, 250, 250]
    return rng() < 0.05 ? [rng() * 255, rng() * 255, rng() * 255, 255] : [r, g, b, 255]
  })
}

function run(): void {
  const mark = makeNoisyMark()

  // 1. Professional Trace produces a real SVG at the source dimensions.
  const professional = runProfessionalTrace(mark)
  assertTrue(professional.svg.startsWith('<svg'), 'runProfessionalTrace produces an SVG document')
  assertTrue(professional.svg.includes('width="64" height="64" viewBox="0 0 64 64"'), 'SVG declares the source dimensions')
  assertEqual(professional.provider, 'vectorla', 'Professional Trace runs the Vectorla engine')
  assertTrue(professional.stageTimings.length > 0, 'engine stage timings are reported')
  assertTrue(professional.totalTimeMs >= 0, 'total time is non-negative')
  console.log(`PASS: runProfessionalTrace (${professional.engine.paletteSize} colors, ${professional.engine.pathCount} paths, ${professional.totalTimeMs.toFixed(1)}ms)`)

  // 2. Salt-and-pepper noise is removed: only the two real colors survive.
  assertEqual(professional.engine.paletteSize, 2, 'noise pixels do not become palette colors')
  assertEqual(professional.engine.pathCount, 2, 'background + square only (speckles merged away)')
  assertTrue(professional.svg.includes('#1e3cc8'), 'square keeps its exact source color')
  console.log('PASS: noise speckles are merged away and colors stay exact')

  // 3. Quick Trace uses a smaller working budget than Professional.
  const quick = runQuickTrace(mark)
  assertTrue(quick.svg.startsWith('<svg'), 'runQuickTrace produces an SVG document')
  assertTrue(
    quick.engine.workingWidth * quick.engine.workingHeight <= professional.engine.workingWidth * professional.engine.workingHeight,
    'Quick Trace never works at a higher resolution than Professional',
  )
  console.log(`PASS: runQuickTrace (working ${quick.engine.workingWidth}x${quick.engine.workingHeight} vs professional ${professional.engine.workingWidth}x${professional.engine.workingHeight})`)

  // 4. Runs are deterministic and stateless.
  const again = runTracePipeline(mark, 'professional')
  assertEqual(again.svg, professional.svg, 'same input and mode give byte-identical output')
  console.log('PASS: consecutive runs are deterministic')

  // 5. JPEG hint enables artifact cleanup without breaking output.
  const jpegTrace = runProfessionalTrace(mark, 'jpeg')
  assertTrue(jpegTrace.engine.denoised, 'JPEG sources are denoised')
  assertTrue(jpegTrace.svg.startsWith('<svg'), 'JPEG-hinted trace still produces an SVG')
  console.log('PASS: JPEG source hint enables edge-preserving denoise')

  // 6. The caller's pixels are never used as engine scratch space: tracing
  // the same image twice (Quick then Professional, as the benchmark does) must
  // match tracing a fresh copy.
  const shared = makeNoisyMark()
  const pristine = shared.data.slice()
  runQuickTrace(shared, 'jpeg')
  assertTrue(shared.data.every((v, i) => v === pristine[i]), 'runTracePipeline leaves the input pixels untouched')
  const fresh = makeNoisyMark()
  assertEqual(runProfessionalTrace(shared, 'jpeg').svg, runProfessionalTrace(fresh, 'jpeg').svg, 'a second trace of the same image matches a fresh copy')
  console.log('PASS: input pixels are left untouched')

  console.log('\nAll Professional Trace pipeline smoke tests passed.')
}

run()
