import type { Upload } from '../types'
import type { VectorizationProvider, VectorizationResult } from './VectorizationProvider'

// TODO(backend): a computer-vision-based tracer (edge/contour detection,
// e.g. via a Cloudflare Workers AI vision model) goes here — a middle ground
// between PotraceProvider (pure bitmap tracing) and OpenAIProvider (full
// generative AI). See ProviderFactory for how this gets selected.
export class VisionProvider implements VectorizationProvider {
  readonly name = 'vision'

  async vectorize(_upload: Upload): Promise<VectorizationResult> {
    throw new Error('Not implemented')
  }
}
