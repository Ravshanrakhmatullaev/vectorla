import type { Upload } from '../types'
import type { VectorizationProvider, VectorizationResult } from './VectorizationProvider'

// TODO(backend): a real call to an OpenAI (or compatible) model for
// generative vectorization goes here — needs a new OPENAI_API_KEY secret
// once implemented. See ProviderFactory for how this gets selected.
export class OpenAIProvider implements VectorizationProvider {
  readonly name = 'openai'

  async vectorize(_upload: Upload): Promise<VectorizationResult> {
    throw new Error('Not implemented')
  }
}
