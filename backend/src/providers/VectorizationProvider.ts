import type { Upload, ExportFormat } from '../types'

export interface VectorizationResult {
  data: ArrayBuffer
  format: ExportFormat
}

/**
 * A vectorization backend: given an uploaded raster image (metadata +
 * decoded-from-R2 file bytes), produces vector output bytes. ConversionService
 * depends on this interface (not a concrete implementation) so the real
 * AI/tracing engine can be swapped in later — see ProviderFactory for how a
 * provider is selected — without touching the pipeline (queue -> processing
 * -> storage -> metadata -> completed) that calls it.
 *
 * Providers only ever see raw bytes, never R2/StorageService — ConversionService
 * fetches `fileBytes` and passes it down, so providers stay pure "bytes in,
 * bytes out" transformers (see Phase 19).
 *
 * `requestedPreset` (Phase 20) is the caller's Job.preset, if any — providers
 * that support presets (see PlaceholderProvider/tracePresets.ts) use it when
 * recognized and fall back to automatic recommendation otherwise.
 */
export interface VectorizationProvider {
  readonly name: string
  vectorize(upload: Upload, fileBytes: ArrayBuffer, requestedPreset?: string | null): Promise<VectorizationResult>
}

export type VectorizationProviderName = 'placeholder' | 'potrace' | 'vision' | 'openai'

export function isVectorizationProviderName(value: string): value is VectorizationProviderName {
  return value === 'placeholder' || value === 'potrace' || value === 'vision' || value === 'openai'
}
