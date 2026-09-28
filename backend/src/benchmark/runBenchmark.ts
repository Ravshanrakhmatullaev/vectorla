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
import { BENCHMARK_CORPUS, type BenchmarkCase, type BenchmarkVariant } from './corpus'
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
  traceMs: number
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

export async function runBenchmark(options: {
  engines: EngineName[]
  cases?: string[]
  outDir?: string
}): Promise<BenchmarkRow[]> {
  const fs = (await import(fsSpecifier)) as NodeFs
  const wasm = await loadDecoderWasmModules()
  const rows: BenchmarkRow[] = []
  if (options.outDir) fs.mkdirSync(options.outDir, { recursive: true })

  const cases: BenchmarkCase[] = BENCHMARK_CORPUS.filter((c) => !options.cases || options.cases.includes(c.id))
  for (const testCase of cases) {
    const aspect = svgAspect(testCase.svg)
    for (const variant of testCase.variants) {
      const srcWidth = aspect >= 1 ? variant.size : Math.round(variant.size * aspect)
      const source = renderSvg(testCase.svg, srcWidth)
      const sourceImage = { width: source.width, height: source.height, data: new Uint8ClampedArray(source.pixels) } as ImageData
      const encoded = variant.format === 'png' ? await encodeTestPng(sourceImage) : await encodeTestJpeg(sourceImage)
      const decoded = await decodeImage(variant.format === 'png' ? 'image/png' : 'image/jpeg', encoded, wasm)

      const scale = Math.max(1, Math.min(EVAL_SCALE, Math.floor(MAX_EVAL_SIDE / Math.max(source.width, source.height))))
      const truth = renderSvg(testCase.svg, source.width * scale)
      const variantName = variantLabel(variant)
      if (options.outDir) {
        fs.writeFileSync(`${options.outDir}/${testCase.id}-${variantName}-source.${variant.format === 'png' ? 'png' : 'jpg'}`, new Uint8Array(encoded))
      }

      for (const engine of options.engines) {
        const start = performance.now()
        let svg: string
        try {
          svg = await traceWith(engine, decoded, variant.format)
        } catch (error) {
          console.error(`[${testCase.id} ${variantName} ${engine}] trace failed:`, error)
          continue
        }
        const traceMs = performance.now() - start
        const traced = renderSvg(svg, truth.width)
        const diff = compareImages(truth.pixels, traced.pixels, truth.width, truth.height, scale)
        rows.push({
          caseId: testCase.id,
          category: testCase.category,
          variant: variantName,
          engine,
          traceMs,
          ...diff,
          ...measureSvgStructure(svg),
        })
        if (options.outDir) {
          const base = `${options.outDir}/${testCase.id}-${variantName}-${engine}`
          fs.writeFileSync(`${base}.svg`, svg)
          fs.writeFileSync(`${base}.png`, traced.png())
        }
      }
    }
  }
  return rows
}

function variantLabel(variant: BenchmarkVariant): string {
  return `${variant.size}${variant.format === 'jpeg' ? 'jpg' : ''}`
}

const fmt = (v: number, digits = 2) => v.toFixed(digits)

export function formatTable(rows: BenchmarkRow[]): string {
  const header = '| Case | Variant | Engine | ΔE×100 | Bad px % | Edge err (px) | Alpha err % | Gaps/10k | Paths | Segments | KB | ms |'
  const sep = '|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|'
  const lines = rows.map(
    (r) =>
      `| ${r.caseId} | ${r.variant} | ${r.engine} | ${fmt(r.meanDeltaE)} | ${fmt(r.badPixelPct)} | ${fmt(r.boundaryError)} | ${fmt(r.alphaErrorPct)} | ${fmt(r.gapsPer10k, 1)} | ${r.pathCount} | ${r.segments} | ${fmt(r.bytes / 1024, 1)} | ${fmt(r.traceMs, 0)} |`,
  )
  return [header, sep, ...lines].join('\n')
}

export function formatSummary(rows: BenchmarkRow[]): string {
  const engines = Array.from(new Set(rows.map((r) => r.engine)))
  const lines = ['| Engine | Mean ΔE×100 | Mean bad px % | Mean edge err (px) | Mean gaps/10k | Total segments | Total KB | Total ms |', '|---|---:|---:|---:|---:|---:|---:|---:|']
  for (const engine of engines) {
    const rs = rows.filter((r) => r.engine === engine)
    const mean = (f: (r: BenchmarkRow) => number) => rs.reduce((s, r) => s + f(r), 0) / Math.max(1, rs.length)
    const sum = (f: (r: BenchmarkRow) => number) => rs.reduce((s, r) => s + f(r), 0)
    lines.push(
      `| ${engine} | ${fmt(mean((r) => r.meanDeltaE))} | ${fmt(mean((r) => r.badPixelPct))} | ${fmt(mean((r) => r.boundaryError))} | ${fmt(mean((r) => r.gapsPer10k), 1)} | ${sum((r) => r.segments)} | ${fmt(sum((r) => r.bytes) / 1024, 1)} | ${fmt(sum((r) => r.traceMs), 0)} |`,
    )
  }
  return lines.join('\n')
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
  const rows = await runBenchmark({ engines, cases, outDir })
  console.log(formatTable(rows))
  console.log('')
  console.log(formatSummary(rows))
  const fs = (await import(fsSpecifier)) as NodeFs
  const jsonPath = args.get('json')
  if (jsonPath) fs.writeFileSync(jsonPath, JSON.stringify(rows, null, 2))

  // --compare[=path]: per-variant deltas against a saved run (default: the
  // committed baseline). --save-baseline: overwrite the committed baseline.
  if (args.has('compare')) {
    const baseline = JSON.parse(new TextDecoder().decode(await readFileSync(args.get('compare') || BASELINE_PATH))) as BenchmarkRow[]
    console.log('')
    console.log(formatComparison(baseline, rows))
  }
  if (args.has('save-baseline')) {
    fs.writeFileSync(BASELINE_PATH, `${JSON.stringify(rows.map(roundRow), null, 1)}\n`)
    console.log(`\nSaved baseline to ${BASELINE_PATH}`)
  }
}

/** Committed reference run (npm run bench -- --save-baseline). Timings are machine-specific and not compared. */
export const BASELINE_PATH = 'src/benchmark/baseline.json'

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
  const lines = ['| Engine | Case | Variant | ΔE×100 | Edge err (px) | Segments | Verdict |', '|---|---|---|---|---|---|---|']
  let regressions = 0
  for (const row of current) {
    const old = before.get(key(row))
    if (!old) {
      lines.push(`| ${row.engine} | ${row.caseId} | ${row.variant} | ${fmt(row.meanDeltaE)} (new) | ${fmt(row.boundaryError)} | ${row.segments} | new |`)
      continue
    }
    const worse = row.meanDeltaE - old.meanDeltaE > 0.02 || row.boundaryError - old.boundaryError > 0.02 || row.segments > old.segments * 1.15
    const better = old.meanDeltaE - row.meanDeltaE > 0.01 || old.boundaryError - row.boundaryError > 0.01 || row.segments < old.segments * 0.9
    if (worse) regressions++
    if (!worse && !better) continue
    lines.push(
      `| ${row.engine} | ${row.caseId} | ${row.variant} | ${fmt(old.meanDeltaE)} → ${fmt(row.meanDeltaE)} | ${fmt(old.boundaryError)} → ${fmt(row.boundaryError)} | ${old.segments} → ${row.segments} | ${worse ? '**WORSE**' : 'better'} |`,
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
