import type { Upload } from '../types'
import type { VectorizationProvider, VectorizationResult } from './VectorizationProvider'
import { decodeImage, type RasterDecoderWasm } from './imageDecoder'
import { traceImage } from '../engine/traceImage'
import { engineOptionsFor, sourceFormatFromMime } from '../engine/profiles'

/**
 * The Vectorla tracing engine (src/engine/) as a VectorizationProvider — the
 * default for every image type. Shared-boundary multi-color tracing with
 * Potrace-grade curve fitting; see engine/traceImage.ts and BENCHMARKS.md.
 *
 * `requestedPreset` selects the Quick profile adjusted for a legacy named
 * preset if one is given; Professional Trace goes through
 * pipeline/ProfessionalTracePipeline.ts instead.
 */
export class VectorlaProvider implements VectorizationProvider {
  readonly name = 'vectorla'

  constructor(private readonly wasm: RasterDecoderWasm) {}

  async vectorize(upload: Upload, fileBytes: ArrayBuffer, requestedPreset?: string | null): Promise<VectorizationResult> {
    const imageData = await decodeImage(upload.mimeType, fileBytes, this.wasm)
    const { svg } = traceImage(imageData, {
      ...engineOptionsFor('quick', requestedPreset),
      sourceFormat: sourceFormatFromMime(upload.mimeType),
    })
    return {
      data: new TextEncoder().encode(svg).buffer as ArrayBuffer,
      format: 'svg',
    }
  }
}
