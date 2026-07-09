import type { Upload } from '../types'
import type { VectorizationProvider, VectorizationResult } from './VectorizationProvider'
import { NotImplementedError } from '../errors'

// TODO(backend): real bitmap-tracing implementation (e.g. the `potrace`
// algorithm) goes here — a good fit for flat-color logos/line art where a
// full AI call is overkill. ProviderSelector (Phase 21) already routes
// monochrome logos here; ConversionService catches this NotImplementedError
// and falls back to the working ImageTracer engine until this is built.
export class PotraceProvider implements VectorizationProvider {
  readonly name = 'potrace'

  async vectorize(_upload: Upload, _fileBytes: ArrayBuffer): Promise<VectorizationResult> {
    throw new NotImplementedError('Not implemented')
  }
}
