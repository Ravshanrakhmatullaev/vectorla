import type { Upload } from '../types'
import type { VectorizationProvider, VectorizationResult } from './VectorizationProvider'
import { NotImplementedError } from '../errors'

// TODO(backend): a computer-vision-based tracer (edge/contour detection,
// e.g. via a Cloudflare Workers AI vision model) goes here — a middle ground
// between PotraceProvider (pure bitmap tracing) and OpenAIProvider (full
// generative AI). ProviderSelector (Phase 21) already routes photographs
// here; ConversionService catches this NotImplementedError and falls back
// to the working ImageTracer engine until this is built.
export class VisionProvider implements VectorizationProvider {
  readonly name = 'vision'

  async vectorize(_upload: Upload, _fileBytes: ArrayBuffer): Promise<VectorizationResult> {
    throw new NotImplementedError('Not implemented')
  }
}
