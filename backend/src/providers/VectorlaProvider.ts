import type { Upload } from '../types'
import type { VectorizationProvider, VectorizationResult } from './VectorizationProvider'
import { decodeForTrace, type DecodedForTrace, type RasterDecoderWasm } from './imageDecoder'
import { traceOwnedImage } from '../engine/traceImage'
import { engineOptionsFor, sourceFormatFromMime, workingCaps } from '../engine/profiles'

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
    const options = engineOptionsFor('quick', requestedPreset)
    const decoded = await decodeForTrace(upload.mimeType, fileBytes, this.wasm, workingCaps(options))
    return this.vectorizeDecoded(upload, decoded, requestedPreset)
  }

  /** Traces an upload already decoded with decodeForTrace (see ConversionService.traceQuick). */
  vectorizeDecoded(upload: Upload, decoded: DecodedForTrace, requestedPreset?: string | null): VectorizationResult {
    const { svg } = traceOwnedImage(decoded, {
      ...engineOptionsFor('quick', requestedPreset),
      sourceFormat: sourceFormatFromMime(upload.mimeType),
      sourceSize: decoded.sourceSize,
    })
    return {
      data: new TextEncoder().encode(svg).buffer as ArrayBuffer,
      format: 'svg',
    }
  }
}
