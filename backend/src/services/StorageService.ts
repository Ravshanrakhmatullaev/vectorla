import type { R2Client } from '../integrations/r2'

// TODO(backend): key naming convention + signed URL generation go here once R2 is provisioned.
export class StorageService {
  constructor(private readonly r2: R2Client) {}

  async storeFile(_key: string, _data: ReadableStream | ArrayBuffer): Promise<void> {
    throw new Error('Not implemented')
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
