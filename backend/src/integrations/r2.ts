import type { R2Bucket } from '@cloudflare/workers-types'

export interface R2Client {
  put(key: string, data: ReadableStream | ArrayBuffer): Promise<void>
  get(key: string): Promise<ReadableStream | null>
  delete(key: string): Promise<void>
  /**
   * Lists object keys under a prefix — used by OrphanCleanupService. Single
   * page only (Cloudflare R2 caps a list() call at 1000 keys and returns a
   * cursor for more); fine for today's scale, but real production-volume
   * cleanup would need to follow `truncated`/`cursor` to page through everything.
   */
  list(prefix: string): Promise<string[]>
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
    async list(prefix) {
      const result = await bucket.list({ prefix })
      return result.objects.map((object) => object.key)
    },
  }
}
