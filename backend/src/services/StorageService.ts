import type { R2Client } from '../integrations/r2'

// TODO(backend): getFile/getSignedDownloadUrl/deleteFile still need real
// implementations — not needed until the conversion/export/download flow is
// built. storeFile is real, used by UploadService.
export class StorageService {
  constructor(private readonly r2: R2Client) {}

  async storeFile(key: string, data: ReadableStream | ArrayBuffer): Promise<void> {
    await this.r2.put(key, data)
  }

  async getFile(_key: string): Promise<ReadableStream> {
    throw new Error('Not implemented')
  }

  async getSignedDownloadUrl(_key: string, _expiresInSeconds = 3600): Promise<string> {
    throw new Error('Not implemented')
  }

  async deleteFile(_key: string): Promise<void> {
    throw new Error('Not implemented')
  }
}
