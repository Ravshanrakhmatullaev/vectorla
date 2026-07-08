import type { Upload } from '../types'
import type { VectorizationProvider, VectorizationResult } from './VectorizationProvider'

// TODO(backend): real bitmap-tracing implementation (e.g. the `potrace`
// algorithm) goes here — a good fit for flat-color logos/line art where a
// full AI call is overkill. See ProviderFactory for how this gets selected.
export class PotraceProvider implements VectorizationProvider {
  readonly name = 'potrace'

  async vectorize(_upload: Upload, _fileBytes: ArrayBuffer): Promise<VectorizationResult> {
    throw new Error('Not implemented')
  }
}
