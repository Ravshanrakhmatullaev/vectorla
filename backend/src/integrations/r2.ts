import type { R2Bucket } from '@cloudflare/workers-types'

export interface R2Client {
  put(key: string, data: ReadableStream | ArrayBuffer): Promise<void>
  get(key: string): Promise<ReadableStream | null>
  delete(key: string): Promise<void>
}

/**
 * Thin wrapper over the Cloudflare R2 binding — see StorageService for the
 * business-facing API (key naming convention, signed URLs) built on top of this.
 */
export function createR2Client(bucket: R2Bucket): R2Client {
  return {
    async put(key, data) {
      await bucket.put(key, data)
    },
    async get(key) {
      const object = await bucket.get(key)
      return object ? object.body : null
    },
    async delete(key) {
      await bucket.delete(key)
    },
  }
}
