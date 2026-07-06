import type { Upload } from '../types'
import type { R2Client } from '../integrations/r2'

export interface CreateUploadInput {
  userId: string
  file: ReadableStream
  originalFileName: string
  mimeType: string
  sizeBytes: number
}

// TODO(backend): wire to StorageService (R2) + Supabase once the AI pipeline is ready.
export class UploadService {
  constructor(private readonly r2: R2Client) {}

  async createUpload(_input: CreateUploadInput): Promise<Upload> {
    throw new Error('Not implemented')
  }

  async getUpload(_uploadId: string): Promise<Upload> {
    throw new Error('Not implemented')
  }

  async deleteUpload(_uploadId: string): Promise<void> {
    throw new Error('Not implemented')
  }
}
