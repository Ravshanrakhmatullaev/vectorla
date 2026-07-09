import type { VectorizationProviderName } from './VectorizationProvider'

export type ImageType = 'photo' | 'illustration' | 'logo'

export interface ProviderSelectionInput {
  imageType: ImageType
  isGrayscale: boolean
}

/**
 * Chooses which VectorizationProvider a job should attempt, based on
 * ImageAnalysisService's classification (Phase 21):
 *
 *   - monochrome logo   -> potrace     (bitmap tracing — still a stub, see
 *                                        PotraceProvider; ConversionService
 *                                        falls back to the working
 *                                        ImageTracer engine if this throws
 *                                        NotImplementedError)
 *   - colored logo /
 *     illustration       -> placeholder (the ImageTracer engine — see
 *                                        PlaceholderProvider.ts for why the
 *                                        name doesn't match what it does)
 *   - photograph         -> vision     (a professional AI-based tracer,
 *                                        also still a stub — same fallback
 *                                        applies; OpenAI itself is
 *                                        explicitly out of scope this phase)
 *
 * Pure and synchronous by design — no I/O, trivially unit-testable, and
 * reusable both for real dispatch (ConversionService) and for the
 * "recommended provider" field shown to the frontend (ImageAnalysisService).
 */
export function selectProvider(input: ProviderSelectionInput): VectorizationProviderName {
  if (input.imageType === 'photo') return 'vision'
  if (input.imageType === 'logo' && input.isGrayscale) return 'potrace'
  return 'placeholder'
}
