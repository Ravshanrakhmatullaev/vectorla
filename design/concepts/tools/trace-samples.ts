// Traces the design-prototype samples with the production pipeline (both modes)
// and writes the upload, both SVGs and measured stats to <out>/<id>/.
// Run from backend/: npx tsx ../design/concepts/tools/trace-samples.ts ../design/concepts/samples
// then regenerate shared/samples.js from samples/samples.json.
import { mkdirSync, writeFileSync } from 'node:fs'
import { prepareSources } from '../../../backend/src/benchmark/runBenchmark'
import { measureSvgStructure } from '../../../backend/src/benchmark/metrics'
import { runTracePipeline } from '../../../backend/src/pipeline/ProfessionalTracePipeline'

const OUT = process.argv[2]!
const SAMPLES: { id: string; corpus: 'core' | 'real' | 'emblem' | 'emblem-photo'; caseId: string; variant: string; credit: string }[] = [
  { id: 'summit-logo', corpus: 'real', caseId: 'logo-complex', variant: '512jpgq40', credit: 'Vectorla benchmark test design' },
  { id: 'alpine-patch', corpus: 'emblem-photo', caseId: 'patch-mountain', variant: '1200jpgq90blur0.6n7', credit: 'Vectorla benchmark test design' },
  { id: 'crest', corpus: 'emblem', caseId: 'crest-gold', variant: '1200jpgq85', credit: 'Vectorla benchmark test design' },
  { id: 'rocket', corpus: 'real', caseId: 'emoji3d-rocket', variant: '256', credit: 'Microsoft Fluent Emoji (MIT)' },
  { id: 'globe', corpus: 'real', caseId: 'emoji3d-globe', variant: '256', credit: 'Microsoft Fluent Emoji (MIT)' },
  { id: 'horse', corpus: 'real', caseId: 'scan-horse', variant: 'original', credit: 'scikit-image sample data, Andreas Preuss (CC0)' },
  { id: 'coffee', corpus: 'real', caseId: 'photo-coffee', variant: 'original', credit: 'scikit-image sample data, Rachel Michetti (CC0)' },
  { id: 'ornament', corpus: 'real', caseId: 'ornament', variant: '512', credit: 'Vectorla benchmark test design' },
  { id: 'wordmark', corpus: 'core', caseId: 'wordmark', variant: '768jpg', credit: 'Vectorla benchmark test design' },
]

const all: unknown[] = []
for (const s of SAMPLES) {
  const [src] = await prepareSources({ corpus: s.corpus, cases: [s.caseId], variants: [s.variant] })
  if (!src) throw new Error(`missing ${s.caseId}@${s.variant}`)
  const dir = `${OUT}/${s.id}`
  mkdirSync(dir, { recursive: true })
  const ext = src.format === 'png' ? 'png' : 'jpg'
  writeFileSync(`${dir}/source.${ext}`, new Uint8Array(src.encoded))
  const modes: Record<string, unknown> = {}
  for (const mode of ['quick', 'professional'] as const) {
    const data = new Uint8ClampedArray(src.decoded.data)
    const image = { width: src.decoded.width, height: src.decoded.height, data } as unknown as ImageData
    const r = runTracePipeline(image, mode, src.format)
    const svg = r.svg
    writeFileSync(`${dir}/${mode === 'quick' ? 'quick' : 'pro'}.svg`, svg)
    const st = measureSvgStructure(svg)
    const fills = new Set([...svg.matchAll(/fill="(#[0-9a-fA-F]{3,6})"/g)].map((m) => m[1]!.toLowerCase()))
    const gradients = (svg.match(/<(linear|radial)Gradient\b/g) ?? []).length
    modes[mode] = { ms: Math.round(r.totalTimeMs), bytes: svg.length, paths: st.pathCount, segments: st.segments, curves: st.curves, colors: fills.size, gradients }
    console.log(s.id, mode, Math.round(r.totalTimeMs), 'ms', (svg.length / 1024).toFixed(1), 'KB', st.pathCount, 'paths', fills.size, 'colors', gradients, 'gradients')
  }
  all.push({ id: s.id, case: `${s.corpus}/${s.caseId}@${s.variant}`, credit: s.credit, source: { file: `source.${ext}`, width: src.decoded.width, height: src.decoded.height, bytes: src.encoded.byteLength, format: src.format }, quick: modes.quick, professional: modes.professional })
}
writeFileSync(`${OUT}/samples.json`, JSON.stringify(all, null, 2))
