/**
 * Staging-only memory probe: runs the conversion's decode + analysis + trace
 * path (the same calls ConversionService.traceQuick/traceProfessional make)
 * inside a real Cloudflare isolate (128 MB), without Supabase, R2 or the
 * queue. Deploy it only for a measurement and delete it afterwards
 * (DEPLOYMENT.md "Memory on Cloudflare").
 *
 *   POST /?mode=quick|professional&ballastMb=N   body: the image bytes
 *   header x-probe-token: <PROBE_TOKEN secret>, content-type: image/png|jpeg|webp
 *
 * `ballastMb` holds N MB of touched memory through the whole request, to
 * find how much headroom a trace leaves below the isolate's memory limit.
 */
import { decodeForTrace, type RasterDecoderWasm } from '../../src/providers/imageDecoder'
import { analyzeImage, type ImageAnalysis } from '../../src/providers/imageAnalysis'
import { runDecodedTracePipeline } from '../../src/pipeline/ProfessionalTracePipeline'
import { VectorlaProvider } from '../../src/providers/VectorlaProvider'
import { createImageAnalysisService, type ImageAnalysisResult } from '../../src/services/ImageAnalysisService'
import { engineOptionsFor, sourceFormatFromMime, workingCaps } from '../../src/engine/profiles'
import type { Upload } from '../../src/types'

interface ProbeEnv {
  PROBE_TOKEN?: string
}

type WasmModuleExports = { default: WebAssembly.Module }
let wasm: RasterDecoderWasm | null = null

async function decoderWasm(): Promise<RasterDecoderWasm> {
  if (wasm) return wasm
  const [png, jpeg, webp] = await Promise.all([
    import('../../node_modules/@jsquash/png/codec/pkg/squoosh_png_bg.wasm') as unknown as Promise<WasmModuleExports>,
    import('../../node_modules/@jsquash/jpeg/codec/dec/mozjpeg_dec.wasm') as unknown as Promise<WasmModuleExports>,
    import('../../node_modules/@jsquash/webp/codec/dec/webp_dec.wasm') as unknown as Promise<WasmModuleExports>,
  ] as const)
  wasm = { png: png.default, jpeg: jpeg.default, webp: webp.default }
  return wasm
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } })
}

export default {
  async fetch(request: Request, env: ProbeEnv): Promise<Response> {
    if (!env.PROBE_TOKEN) return json({ ok: false, error: 'PROBE_TOKEN is not set' }, 503)
    if (request.method !== 'POST' || request.headers.get('x-probe-token') !== env.PROBE_TOKEN) return json({ ok: false }, 404)

    const url = new URL(request.url)
    const mode = url.searchParams.get('mode') === 'professional' ? 'professional' : 'quick'
    const ballastMb = Math.max(0, Math.min(1024, Number(url.searchParams.get('ballastMb') ?? 0) || 0))
    const mimeType = request.headers.get('content-type') ?? 'image/png'

    // 1 MB chunks: one typed array is capped at 128 MB regardless of the isolate limit.
    const ballast: Uint8Array[] = []
    for (let i = 0; i < ballastMb; i++) ballast.push(new Uint8Array(1024 * 1024).fill(1))

    const start = Date.now()
    try {
      const fileBytes = await request.arrayBuffer()
      const wasmModules = await decoderWasm()
      const upload: Upload = {
        id: 'probe',
        userId: 'probe',
        originalFileName: 'probe',
        mimeType,
        sizeBytes: fileBytes.byteLength,
        storageKey: 'probe',
        status: 'stored',
        createdAt: new Date().toISOString(),
      }
      let svgBytes: number
      let width = 0
      let height = 0
      if (mode === 'professional') {
        let analysis!: ImageAnalysis
        const decoded = await decodeForTrace(mimeType, fileBytes, wasmModules, workingCaps(engineOptionsFor('professional')), (full) => {
          analysis = analyzeImage(full)
          ;({ width, height } = full)
        })
        const result = runDecodedTracePipeline(decoded, analysis, 'professional', sourceFormatFromMime(mimeType))
        svgBytes = new TextEncoder().encode(result.svg).byteLength
      } else {
        let analysis!: ImageAnalysisResult
        const decoded = await decodeForTrace(mimeType, fileBytes, wasmModules, workingCaps(engineOptionsFor('quick', null)), (full) => {
          analysis = createImageAnalysisService(wasmModules).analyzeDecoded(full)
          ;({ width, height } = full)
        })
        if (analysis.recommendedProvider !== 'vectorla') throw new Error(`unexpected provider ${analysis.recommendedProvider}`)
        svgBytes = new VectorlaProvider(wasmModules).vectorizeDecoded(upload, decoded, null).data.byteLength
      }
      return json({ ok: true, mode, mimeType, fileBytes: fileBytes.byteLength, width, height, svgBytes, ms: Date.now() - start, ballastMb, ballastCheck: ballast.length })
    } catch (error) {
      const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
      return json({ ok: false, mode, error: message.slice(0, 300), ms: Date.now() - start, ballastMb, ballastCheck: ballast.length }, 500)
    }
  },
}
