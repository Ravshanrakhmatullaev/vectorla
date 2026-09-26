import type { VectorizationProviderName } from './VectorizationProvider'

export type ImageType = 'photo' | 'illustration' | 'logo'

export interface ProviderSelectionInput {
  imageType: ImageType
  isGrayscale: boolean
}

/**
 * Chooses which VectorizationProvider a job should attempt, based on
 * ImageAnalysisService's classification.
 *
 * Every image type now routes to the Vectorla engine (src/engine/): on the
 * render-and-diff benchmark it beats the ImageTracer ('placeholder') and
 * Potrace paths on every category — flat logos, monochrome marks, text,
 * stickers, illustrations and gradients (see BENCHMARKS.md). ImageTracer
 * remains the automatic fallback if the engine fails (ConversionService), and
 * 'vision'/'openai' stay reserved for a future AI-assisted photo pipeline.
 *
 * Pure and synchronous by design — no I/O, trivially unit-testable, and
 * reusable both for real dispatch (ConversionService) and for the
 * "recommended provider" field shown to the frontend (ImageAnalysisService).
 */
export function selectProvider(input: ProviderSelectionInput): VectorizationProviderName {
  switch (input.imageType) {
    case 'photo':
    case 'illustration':
    case 'logo':
      return 'vectorla'
  }
}
