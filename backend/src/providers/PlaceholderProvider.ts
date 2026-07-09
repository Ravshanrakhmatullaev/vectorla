import type { Upload } from '../types'
import type { VectorizationProvider, VectorizationResult } from './VectorizationProvider'
import { optimizeSvg } from './svgOptimizer'
import { TRACE_PRESETS, isTracePresetName } from './tracePresets'
import { analyzeImage, type ImageAnalysis } from './imageAnalysis'
import { decodeImage, type RasterDecoderWasm } from './imageDecoder'
import ImageTracer from 'imagetracerjs'

export type { RasterDecoderWasm } from './imageDecoder'

/**
 * The real vectorization engine (Phase 19) — despite the name/file location
 * (kept as-is per that phase's "no config/API changes" rule; this is what
 * VECTORIZATION_PROVIDER="placeholder" now points at), this is no longer a
 * placeholder. Decodes the uploaded PNG/JPEG/WEBP via jSquash's WASM codecs
 * (built for exactly this — Cloudflare Workers/edge runtimes, see
 * ProviderFactory for how the .wasm modules are supplied) into raw pixels,
 * analyzes them (Phase 20 — see imageAnalysis.ts) to pick a trace preset
 * when the caller didn't request one, then traces them into a real,
 * full-color SVG with ImageTracer.js (pure JS, no further dependencies).
 * See PotraceProvider/VisionProvider/OpenAIProvider for the options this
 * phase deliberately left as stubs.
 */
export class PlaceholderProvider implements VectorizationProvider {
  readonly name = 'placeholder'

  constructor(private readonly wasm: RasterDecoderWasm) {}

  async vectorize(upload: Upload, fileBytes: ArrayBuffer, requestedPreset?: string | null): Promise<VectorizationResult> {
    const imageData = await decodeImage(upload.mimeType, fileBytes, this.wasm)
    const analysis = analyzeImage(imageData)
    const preset = requestedPreset && isTracePresetName(requestedPreset) ? requestedPreset : analysis.recommendedPreset

    const rawSvg = ImageTracer.imagedataToSVG(imageData, TRACE_PRESETS[preset])
    const svg = optimizeSvg(rawSvg, { width: imageData.width, height: imageData.height })

    return {
      data: new TextEncoder().encode(svg).buffer as ArrayBuffer,
      format: 'svg',
    }
  }

  /** Exposed for callers/tests that want the analysis+preset decision without re-running the full trace (see smoke tests). */
  async analyze(upload: Upload, fileBytes: ArrayBuffer): Promise<{ analysis: ImageAnalysis; imageData: ImageData }> {
    const imageData = await decodeImage(upload.mimeType, fileBytes, this.wasm)
    return { analysis: analyzeImage(imageData), imageData }
  }
}
