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
  /** One page of objects under a prefix, with upload times — the orphan sweep pages with `cursor`. */
  listPage(prefix: string, cursor?: string, limit?: number): Promise<R2ListPage>
}

export interface R2ListPage {
  objects: Array<{ key: string; uploaded: Date }>
  /** Present when more objects follow. */
  cursor?: string
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
    async listPage(prefix, cursor, limit = 1000) {
      const result = await bucket.list({ prefix, cursor, limit })
      return {
        objects: result.objects.map((object) => ({ key: object.key, uploaded: object.uploaded })),
        cursor: result.truncated ? result.cursor : undefined,
      }
    },
  }
}
