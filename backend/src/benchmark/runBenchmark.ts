/**
 * Vectorla render-and-diff benchmark (Node only — never imported by the Worker).
 *
 *   npx tsx src/benchmark/runBenchmark.ts [--engines=quick,professional,legacy,engine-default]
 *        [--cases=flat-logo,wordmark] [--out=benchmark-output] [--json=results.json]
 *        [--compare[=baseline.json]] [--save-baseline]
 *
 * For every corpus case and raster variant: render the ground-truth SVG to a
 * raster, encode it as PNG/JPEG exactly as a customer upload would be, decode
 * it through the production decoder, trace it with each engine, render the
 * traced SVG at 4x, and diff it against the ground truth at 4x.
 */
import { Resvg } from '@resvg/resvg-js'
import { BENCHMARK_CORPUS, type BenchmarkVariant } from './corpus'
import { REAL_WORLD_CORPUS } from './realWorldCorpus'
import { compareImages, measureSvgStructure, type ImageDiffMetrics, type SvgStructure } from './metrics'
import { traceImage } from '../engine/traceImage'
import { runQuickTrace, runProfessionalTrace } from '../pipeline/ProfessionalTracePipeline'
import { analyzeImage } from '../providers/imageAnalysis'
import { TRACE_PRESETS } from '../providers/tracePresets'
import { optimizeSvg } from '../providers/svgOptimizer'
import ImageTracer from 'imagetracerjs'
import { decodeImage } from '../providers/imageDecoder'
import { loadDecoderWasmModules } from '../testSupport/wasmTestFixtures'
import { encodeTestJpeg, encodeTestPng } from '../testSupport/rasterEncode'
import { readFileSync } from '../testSupport/node-fs.js'

interface NodeFs {
  writeFileSync(path: string, data: string | Uint8Array): void
  mkdirSync(path: string, options: { recursive: boolean }): void
}
const fsSpecifier: string = 'node:fs'
const childProcessSpecifier: string = 'node:child_process'
const processRef = (globalThis as unknown as { process: { argv: string[]; exitCode?: number } }).process

/**
 * quick / professional: the two product modes (Vectorla engine profiles).
 * engine-default: the engine with its raw defaults (for tuning work).
 * legacy: the pre-engine production path (analysis -> preset -> ImageTracer).
 */
export type EngineName = 'quick' | 'professional' | 'engine-default' | 'legacy'

export interface BenchmarkRow extends ImageDiffMetrics, SvgStructure {
  caseId: string
  category: string
  variant: string
  engine: EngineName
  /** What the trace is compared with: the ground-truth vector, or (photos/scans) the source raster. */
  reference?: 'vector' | 'raster'
  /** The trace threw or produced an empty SVG. */
  failed?: boolean
  traceMs: number
  /** Approximate peak memory of the trace in MB (only with --memory; measured in a child process). */
  peakMemoryMb?: number
}

const EVAL_SCALE = 4
const MAX_EVAL_SIDE = 2400

function renderSvg(svg: string, width: number): { pixels: Uint8Array; width: number; height: number; png: () => Uint8Array } {
  const resvg = new Resvg(svg, {
    fitTo: { mode: 'width', value: width },
    font: { loadSystemFonts: true, defaultFontFamily: 'DejaVu Sans' },
  })
  const rendered = resvg.render()
  // resvg hands back premultiplied RGBA; PNG uploads (and our metrics) use
  // straight alpha, so un-premultiply.
  const pixels = new Uint8Array(rendered.pixels)
  for (let i = 0; i < pixels.length; i += 4) {
    const a = pixels[i + 3]!
    if (a > 0 && a < 255) {
      pixels[i] = Math.min(255, Math.round((pixels[i]! * 255) / a))
      pixels[i + 1] = Math.min(255, Math.round((pixels[i + 1]! * 255) / a))
      pixels[i + 2] = Math.min(255, Math.round((pixels[i + 2]! * 255) / a))
    }
  }
  return {
    pixels,
    width: rendered.width,
    height: rendered.height,
    png: () => new Uint8Array(rendered.asPng()),
  }
}

function svgAspect(svg: string): number {
  const match = svg.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/)
  if (!match) return 1
  return Number(match[1]) / Number(match[2])
}

async function traceWith(engine: EngineName, imageData: ImageData, format: 'png' | 'jpeg'): Promise<string> {
  switch (engine) {
    case 'quick':
      return runQuickTrace(imageData, format).svg
    case 'professional':
      return runProfessionalTrace(imageData, format).svg
    case 'engine-default':
      return traceImage(imageData, { sourceFormat: format }).svg
    case 'legacy': {
      const preset = analyzeImage(imageData).recommendedPreset
      return optimizeSvg(ImageTracer.imagedataToSVG(imageData, TRACE_PRESETS[preset]), { width: imageData.width, height: imageData.height })
    }
  }
}

export type CorpusName = 'core' | 'real' | 'all'

/** One raster exactly as a customer would upload it, plus what it is judged against. */
export interface PreparedSource {
  caseId: string
  category: string
  variant: string
  format: 'png' | 'jpeg'
  /** The upload's bytes (PNG/JPEG) and the production decoder's output for them. */
  encoded: ArrayBuffer
  decoded: ImageData
  /** 'vector': ground-truth SVG rendered at evalScale; 'raster': the decoded source itself (photos/scans). */
  reference: 'vector' | 'raster'
  truth: { pixels: Uint8Array; width: number; height: number }
  evalScale: number
  /** PNG of the ground-truth render, for the visual report (vector references only). */
  truthPng?: () => Uint8Array
}

const ASSETS_DIR = 'src/benchmark/assets'

function gaussianBlur(image: { pixels: Uint8Array; width: number; height: number }, sigma: number): Uint8Array {
  const { pixels, width, height } = image
  const radius = Math.ceil(sigma * 3)
  const kernel = Array.from({ length: radius * 2 + 1 }, (_, i) => Math.exp(-((i - radius) ** 2) / (2 * sigma * sigma)))
  const kSum = kernel.reduce((a, b) => a + b, 0)
  // Premultiplied float RGBA so transparent pixels do not bleed black into edges.
  const src = new Float32Array(width * height * 4)
  for (let p = 0; p < width * height; p++) {
    const a = pixels[p * 4 + 3]! / 255
    src[p * 4] = pixels[p * 4]! * a
    src[p * 4 + 1] = pixels[p * 4 + 1]! * a
    src[p * 4 + 2] = pixels[p * 4 + 2]! * a
    src[p * 4 + 3] = pixels[p * 4 + 3]!
  }
  const pass = (input: Float32Array, horizontal: boolean): Float32Array => {
    const out = new Float32Array(input.length)
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        for (let c = 0; c < 4; c++) {
          let acc = 0
          for (let k = -radius; k <= radius; k++) {
            const sx = horizontal ? Math.min(width - 1, Math.max(0, x + k)) : x
            const sy = horizontal ? y : Math.min(height - 1, Math.max(0, y + k))
            acc += input[(sy * width + sx) * 4 + c]! * kernel[k + radius]!
          }
          out[(y * width + x) * 4 + c] = acc / kSum
        }
      }
    }
    return out
  }
  const blurred = pass(pass(src, true), false)
  const result = new Uint8Array(pixels.length)
  for (let p = 0; p < width * height; p++) {
    const a = blurred[p * 4 + 3]!
    const scale = a > 0 ? 255 / a : 0
    result[p * 4] = Math.round(Math.min(255, blurred[p * 4]! * scale))
    result[p * 4 + 1] = Math.round(Math.min(255, blurred[p * 4 + 1]! * scale))
    result[p * 4 + 2] = Math.round(Math.min(255, blurred[p * 4 + 2]! * scale))
    result[p * 4 + 3] = Math.round(a)
  }
  return result
}

/** JPEG has no alpha: composite transparent sources over white, like any export to JPEG. */
function flattenOnWhite(pixels: Uint8Array): Uint8Array {
  const out = new Uint8Array(pixels.length)
  for (let i = 0; i < pixels.length; i += 4) {
    const a = pixels[i + 3]! / 255
    out[i] = Math.round(pixels[i]! * a + 255 * (1 - a))
    out[i + 1] = Math.round(pixels[i + 1]! * a + 255 * (1 - a))
    out[i + 2] = Math.round(pixels[i + 2]! * a + 255 * (1 - a))
    out[i + 3] = 255
  }
  return out
}

interface CaseSpec {
  id: string
  category: string
  svg?: string
  raster?: string
  variants: BenchmarkVariant[]
}

async function corpusCases(corpus: CorpusName): Promise<CaseSpec[]> {
  const specs: CaseSpec[] = []
  if (corpus !== 'real') specs.push(...BENCHMARK_CORPUS)
  if (corpus !== 'core') {
    for (const c of REAL_WORLD_CORPUS) {
      const svgText = c.svgFile ? new TextDecoder().decode(await readFileSync(`${ASSETS_DIR}/${c.svgFile}`)) : c.svg
      specs.push({ id: c.id, category: c.category, svg: svgText, raster: c.raster, variants: c.variants })
    }
  }
  return specs
}

/** Renders, degrades, encodes and decodes every corpus raster once. */
export async function prepareSources(options: { corpus?: CorpusName; cases?: string[] }): Promise<PreparedSource[]> {
  const wasm = await loadDecoderWasmModules()
  const prepared: PreparedSource[] = []
  for (const spec of await corpusCases(options.corpus ?? 'core')) {
    if (options.cases && !options.cases.includes(spec.id)) continue
    for (const variant of spec.variants) {
      if (spec.raster) {
        const bytes = await readFileSync(`${ASSETS_DIR}/${spec.raster}`)
        const format = spec.raster.endsWith('.png') ? 'png' : 'jpeg'
        const encoded = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
        const decoded = await decodeImage(format === 'png' ? 'image/png' : 'image/jpeg', encoded, wasm)
        prepared.push({
          caseId: spec.id,
          category: spec.category,
          variant: 'original',
          format,
          encoded,
          decoded,
          reference: 'raster',
          truth: { pixels: new Uint8Array(decoded.data), width: decoded.width, height: decoded.height },
          evalScale: 1,
        })
        continue
      }
      const svgText = spec.svg!
      const aspect = svgAspect(svgText)
      const srcWidth = aspect >= 1 ? variant.size : Math.round(variant.size * aspect)
      const source = renderSvg(svgText, srcWidth)
      let pixels = variant.blur ? gaussianBlur(source, variant.blur) : source.pixels
      if (variant.format === 'jpeg') pixels = flattenOnWhite(pixels)
      const sourceImage = { width: source.width, height: source.height, data: new Uint8ClampedArray(pixels) } as ImageData
      const encoded = variant.format === 'png' ? await encodeTestPng(sourceImage) : await encodeTestJpeg(sourceImage, variant.quality ?? 75)
      const decoded = await decodeImage(variant.format === 'png' ? 'image/png' : 'image/jpeg', encoded, wasm)
      const evalScale = Math.max(1, Math.min(EVAL_SCALE, Math.floor(MAX_EVAL_SIDE / Math.max(source.width, source.height))))
      const truth = renderSvg(svgText, source.width * evalScale)
      prepared.push({
        caseId: spec.id,
        category: spec.category,
        variant: variantLabel(variant),
        format: variant.format,
        encoded,
        decoded,
        reference: 'vector',
        truth: { pixels: truth.pixels, width: truth.width, height: truth.height },
        evalScale,
        truthPng: truth.png,
      })
    }
  }
  return prepared
}

export async function runBenchmark(options: {
  engines: EngineName[]
  cases?: string[]
  corpus?: CorpusName
  outDir?: string
}): Promise<BenchmarkRow[]> {
  const fs = (await import(fsSpecifier)) as NodeFs
  const rows: BenchmarkRow[] = []
  if (options.outDir) fs.mkdirSync(options.outDir, { recursive: true })
  for (const source of await prepareSources(options)) {
    if (options.outDir) {
      fs.writeFileSync(`${options.outDir}/${source.caseId}-${source.variant}-source.${source.format === 'png' ? 'png' : 'jpg'}`, new Uint8Array(source.encoded))
    }
    for (const engine of options.engines) {
      const start = performance.now()
      let svg: string
      try {
        svg = await traceWith(engine, source.decoded, source.format)
      } catch (error) {
        console.error(`[${source.caseId} ${source.variant} ${engine}] trace failed:`, error)
        rows.push(failedRow(source, engine, performance.now() - start))
        continue
      }
      const traceMs = performance.now() - start
      const structure = measureSvgStructure(svg)
      if (structure.pathCount === 0) {
        console.error(`[${source.caseId} ${source.variant} ${engine}] trace produced no paths`)
        rows.push(failedRow(source, engine, traceMs))
        continue
      }
      const traced = renderSvg(svg, source.truth.width)
      const diff = compareImages(source.truth.pixels, traced.pixels, source.truth.width, source.truth.height, source.evalScale)
      rows.push({
        caseId: source.caseId,
        category: source.category,
        variant: source.variant,
        engine,
        reference: source.reference,
        failed: false,
        traceMs,
        ...diff,
        ...structure,
      })
      if (options.outDir) {
        const base = `${options.outDir}/${source.caseId}-${source.variant}-${engine}`
        fs.writeFileSync(`${base}.svg`, svg)
        fs.writeFileSync(`${base}.png`, traced.png())
      }
    }
    if (options.outDir && source.truthPng) {
      fs.writeFileSync(`${options.outDir}/${source.caseId}-${source.variant}-truth.png`, source.truthPng())
    }
  }
  return rows
}

function failedRow(source: PreparedSource, engine: EngineName, traceMs: number): BenchmarkRow {
  return {
    caseId: source.caseId,
    category: source.category,
    variant: source.variant,
    engine,
    reference: source.reference,
    failed: true,
    traceMs,
    meanDeltaE: NaN,
    badPixelPct: NaN,
    boundaryError: NaN,
    alphaErrorPct: NaN,
    gapsPer10k: NaN,
    edgeLengthRatio: NaN,
    bytes: 0,
    pathCount: 0,
    segments: 0,
    curves: 0,
    underlaySegments: 0,
  }
}

function variantLabel(variant: BenchmarkVariant): string {
  if (variant.size === 0) return 'original'
  let label = `${variant.size}${variant.format === 'jpeg' ? 'jpg' : ''}`
  if (variant.quality !== undefined) label += `q${variant.quality}`
  if (variant.blur) label += `blur${variant.blur}`
  return label
}

const fmt = (v: number, digits = 2) => v.toFixed(digits)

export function formatTable(rows: BenchmarkRow[]): string {
  const header = '| Case | Variant | Engine | Ref | ΔE×100 | Bad px % | Edge err (px) | Edge len ratio | Alpha err % | Gaps/10k | Paths | Segments | KB | ms | Peak MB |'
  const sep = '|---|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|'
  const lines = rows.map((r) =>
    r.failed
      ? `| ${r.caseId} | ${r.variant} | ${r.engine} | ${r.reference ?? 'vector'} | **FAILED** | | | | | | | | | ${fmt(r.traceMs, 0)} | |`
      : `| ${r.caseId} | ${r.variant} | ${r.engine} | ${r.reference ?? 'vector'} | ${fmt(r.meanDeltaE)} | ${fmt(r.badPixelPct)} | ${r.reference === 'raster' ? 'n/a' : fmt(r.boundaryError)} | ${r.reference === 'raster' ? 'n/a' : fmt(r.edgeLengthRatio)} | ${fmt(r.alphaErrorPct)} | ${r.reference === 'raster' ? 'n/a' : fmt(r.gapsPer10k, 1)} | ${r.pathCount} | ${r.segments} | ${fmt(r.bytes / 1024, 1)} | ${fmt(r.traceMs, 0)} | ${r.peakMemoryMb !== undefined ? show(r.peakMemoryMb, 0) : ''} |`,
  )
  return [header, sep, ...lines].join('\n')
}

const ok = (r: BenchmarkRow) => !r.failed
const meanOf = (rs: BenchmarkRow[], f: (r: BenchmarkRow) => number) => {
  const values = rs.map(f).filter((v) => Number.isFinite(v))
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : NaN
}
const sumOf = (rs: BenchmarkRow[], f: (r: BenchmarkRow) => number) => rs.reduce((s, r) => s + f(r), 0)
const show = (v: number, digits = 2) => (Number.isFinite(v) ? v.toFixed(digits) : 'n/a')

export function formatSummary(rows: BenchmarkRow[]): string {
  const engines = Array.from(new Set(rows.map((r) => r.engine)))
  const lines = [
    '| Engine | Images | Failed | Mean ΔE×100 | Mean bad px % | Mean edge err (px)¹ | Mean edge-length ratio¹ | Mean gaps/10k¹ | Total segments | Total KB | Total ms | Max peak MB |',
    '|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|',
  ]
  for (const engine of engines) {
    const rs = rows.filter((r) => r.engine === engine)
    const good = rs.filter(ok)
    const vector = good.filter((r) => r.reference !== 'raster')
    const peaks = rs.map((r) => r.peakMemoryMb ?? NaN).filter(Number.isFinite)
    lines.push(
      `| ${engine} | ${rs.length} | ${rs.length - good.length} | ${show(meanOf(good, (r) => r.meanDeltaE))} | ${show(meanOf(good, (r) => r.badPixelPct))} | ${show(meanOf(vector, (r) => r.boundaryError))} | ${show(meanOf(vector, (r) => r.edgeLengthRatio))} | ${show(meanOf(vector, (r) => r.gapsPer10k), 1)} | ${sumOf(good, (r) => r.segments)} | ${show(sumOf(good, (r) => r.bytes) / 1024, 1)} | ${show(sumOf(rs, (r) => r.traceMs), 0)} | ${peaks.length ? show(Math.max(...peaks), 0) : 'n/a'} |`,
    )
  }
  lines.push('', '¹ Vector-reference images only (photos and scans have no ground-truth edges).')
  return lines.join('\n')
}

/** Per category × engine means, so one category's gain cannot hide another's loss. */
export function formatCategorySummary(rows: BenchmarkRow[]): string {
  const engines = Array.from(new Set(rows.map((r) => r.engine)))
  const categories = Array.from(new Set(rows.map((r) => r.category)))
  const lines = [
    '| Category | Engine | Images | ΔE×100 | Bad px % | Edge err (px) | Edge-length ratio | Segments (mean) | KB (mean) | ms (mean) |',
    '|---|---|---:|---:|---:|---:|---:|---:|---:|---:|',
  ]
  for (const category of categories) {
    for (const engine of engines) {
      const rs = rows.filter((r) => r.category === category && r.engine === engine)
      if (!rs.length) continue
      const good = rs.filter(ok)
      const vector = good.filter((r) => r.reference !== 'raster')
      lines.push(
        `| ${category} | ${engine} | ${rs.length}${good.length < rs.length ? ` (${rs.length - good.length} failed)` : ''} | ${show(meanOf(good, (r) => r.meanDeltaE))} | ${show(meanOf(good, (r) => r.badPixelPct))} | ${show(meanOf(vector, (r) => r.boundaryError))} | ${show(meanOf(vector, (r) => r.edgeLengthRatio))} | ${show(meanOf(good, (r) => r.segments), 0)} | ${show(meanOf(good, (r) => r.bytes / 1024), 1)} | ${show(meanOf(rs, (r) => r.traceMs), 0)} |`,
      )
    }
  }
  return lines.join('\n')
}

/**
 * --memory: re-runs each trace in a fresh child process and records how far
 * the process's peak resident memory rises during the trace alone (the
 * source pixels are handed over as raw RGBA, so decoding and ground-truth
 * rendering are not counted). Approximate: includes GC slack.
 */
async function measureMemory(rows: BenchmarkRow[], sources: PreparedSource[]): Promise<void> {
  const fs = (await import(fsSpecifier)) as NodeFs & { mkdtempSync(prefix: string): string }
  const { spawnSync } = (await import(childProcessSpecifier)) as { spawnSync: (cmd: string, args: string[], opts: { encoding: 'utf8' }) => { stdout: string; status: number | null } }
  const dir = fs.mkdtempSync('/tmp/vectorla-mem-')
  for (const source of sources) {
    const raw = `${dir}/${source.caseId}-${source.variant}.rgba`
    fs.writeFileSync(raw, new Uint8Array(source.decoded.data.buffer, source.decoded.data.byteOffset, source.decoded.data.byteLength))
    for (const row of rows.filter((r) => r.caseId === source.caseId && r.variant === source.variant && !r.failed)) {
      const run = spawnSync('npx', ['tsx', 'src/benchmark/memoryProbe.ts', raw, String(source.decoded.width), String(source.decoded.height), source.format, row.engine], { encoding: 'utf8' })
      const match = run.stdout.match(/PEAK_MB=([\d.]+)/)
      row.peakMemoryMb = match ? Number(match[1]) : NaN
    }
  }
}

async function main(): Promise<void> {
  const args = new Map(
    processRef.argv
      .slice(2)
      .filter((a) => a.startsWith('--'))
      .map((a) => {
        const [k, v] = a.slice(2).split('=')
        return [k ?? '', v ?? ''] as const
      }),
  )
  const engines = (args.get('engines') || 'quick,professional,legacy').split(',') as EngineName[]
  const cases = args.get('cases') ? args.get('cases')!.split(',') : undefined
  const outDir = args.get('out') || undefined
  const corpus = (args.get('corpus') || 'core') as CorpusName
  const rows = await runBenchmark({ engines, cases, corpus, outDir })
  if (args.has('memory')) await measureMemory(rows, await prepareSources({ corpus, cases }))
  console.log(formatTable(rows))
  console.log('')
  console.log(formatSummary(rows))
  console.log('')
  console.log(formatCategorySummary(rows))
  const fs = (await import(fsSpecifier)) as NodeFs
  const jsonPath = args.get('json')
  if (jsonPath) fs.writeFileSync(jsonPath, JSON.stringify(rows, null, 2))

  // --compare[=path]: per-variant deltas against a saved run (default: the
  // committed baseline). --save-baseline: overwrite the committed baseline.
  if (args.has('compare')) {
    const baseline = JSON.parse(new TextDecoder().decode(await readFileSync(args.get('compare') || baselinePathFor(corpus)))) as BenchmarkRow[]
    console.log('')
    console.log(formatComparison(baseline, rows))
  }
  if (args.has('save-baseline')) {
    fs.writeFileSync(baselinePathFor(corpus), `${JSON.stringify(rows.map(roundRow), null, 1)}\n`)
    console.log(`\nSaved baseline to ${baselinePathFor(corpus)}`)
  }
}

/** Committed reference run (npm run bench -- --save-baseline). Timings are machine-specific and not compared. */
export const BASELINE_PATH = 'src/benchmark/baseline.json'
/** The real-world corpus keeps its own baseline so the core quality gate stays unchanged. */
export const REAL_WORLD_BASELINE_PATH = 'src/benchmark/baseline-realworld.json'
const baselinePathFor = (corpus: CorpusName) => (corpus === 'core' ? BASELINE_PATH : REAL_WORLD_BASELINE_PATH)

function roundRow(row: BenchmarkRow): BenchmarkRow {
  const out = { ...row } as Record<string, unknown>
  for (const [key, value] of Object.entries(out)) if (typeof value === 'number') out[key] = Math.round(value * 1000) / 1000
  return out as unknown as BenchmarkRow
}

/**
 * Per-variant comparison: flags any variant whose color error or edge error
 * got worse by more than 0.02, or whose node count grew by more than 15%.
 */
export function formatComparison(baseline: BenchmarkRow[], current: BenchmarkRow[]): string {
  const key = (r: BenchmarkRow) => `${r.engine}|${r.caseId}|${r.variant}`
  const before = new Map(baseline.map((r) => [key(r), r]))
  const lines = ['| Engine | Case | Variant | ΔE×100 | Edge err (px) | Segments | KB | Verdict |', '|---|---|---|---|---|---|---|---|']
  let regressions = 0
  for (const row of current) {
    const old = before.get(key(row))
    if (!old) {
      lines.push(`| ${row.engine} | ${row.caseId} | ${row.variant} | ${fmt(row.meanDeltaE)} (new) | ${fmt(row.boundaryError)} | ${row.segments} | ${fmt(row.bytes / 1024, 1)} | new |`)
      continue
    }
    const worse =
      row.meanDeltaE - old.meanDeltaE > 0.02 ||
      row.boundaryError - old.boundaryError > 0.02 ||
      row.segments > old.segments * 1.15 ||
      row.bytes > old.bytes * 1.3
    const better = old.meanDeltaE - row.meanDeltaE > 0.01 || old.boundaryError - row.boundaryError > 0.01 || row.segments < old.segments * 0.9
    if (worse) regressions++
    if (!worse && !better) continue
    lines.push(
      `| ${row.engine} | ${row.caseId} | ${row.variant} | ${fmt(old.meanDeltaE)} → ${fmt(row.meanDeltaE)} | ${fmt(old.boundaryError)} → ${fmt(row.boundaryError)} | ${old.segments} → ${row.segments} | ${fmt(old.bytes / 1024, 1)} → ${fmt(row.bytes / 1024, 1)} | ${worse ? '**WORSE**' : 'better'} |`,
    )
  }
  lines.push('', `${regressions} regression(s) against the baseline; unchanged variants omitted.`)
  return lines.join('\n')
}

const invokedDirectly = processRef.argv[1]?.includes('runBenchmark')
if (invokedDirectly) {
  main().catch((error) => {
    console.error(error)
    processRef.exitCode = 1
  })
}
