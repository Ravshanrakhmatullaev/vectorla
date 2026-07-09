import type { Upload } from '../types'
import type { VectorizationProvider, VectorizationResult } from './VectorizationProvider'
import { NotImplementedError } from '../errors'

// TODO(backend): a real call to an OpenAI (or compatible) model for
// generative vectorization goes here — needs a new OPENAI_API_KEY secret
// once implemented. Not part of ProviderSelector's rules yet (Phase 21
// explicitly leaves this unimplemented — see PROJECT_CONTEXT.md).
export class OpenAIProvider implements VectorizationProvider {
  readonly name = 'openai'

  async vectorize(_upload: Upload, _fileBytes: ArrayBuffer): Promise<VectorizationResult> {
    throw new NotImplementedError('Not implemented')
  }
}
