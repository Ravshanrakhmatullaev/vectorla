import type { Job, Conversion } from '../types'

// TODO(backend): this is where the real AI vectorization call goes once it exists —
// today this only defines the shape the queue consumer will call.
export class ConversionService {
  async processJob(_job: Job): Promise<Conversion[]> {
    throw new Error('Not implemented')
  }

  async getConversion(_conversionId: string): Promise<Conversion> {
    throw new Error('Not implemented')
  }
}
