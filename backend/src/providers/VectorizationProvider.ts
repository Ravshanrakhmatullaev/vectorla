import type { Upload, ExportFormat } from '../types'

export interface VectorizationResult {
  data: ArrayBuffer
  format: ExportFormat
}

/**
 * A vectorization backend: given an uploaded raster image, produces vector
 * output bytes. ConversionService depends on this interface (not a concrete
 * implementation) so the real AI/tracing engine can be swapped in later —
 * see ProviderFactory for how a provider is selected — without touching the
 * pipeline (queue -> processing -> storage -> metadata -> completed) that
 * calls it.
 */
export interface VectorizationProvider {
  readonly name: string
  vectorize(upload: Upload): Promise<VectorizationResult>
}

export type VectorizationProviderName = 'placeholder' | 'potrace' | 'vision' | 'openai'

export function isVectorizationProviderName(value: string): value is VectorizationProviderName {
  return value === 'placeholder' || value === 'potrace' || value === 'vision' || value === 'openai'
}
