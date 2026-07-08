import type { Upload } from '../types'
import type { UploadsRepository } from './UploadsRepository'

/**
 * In-memory fallback used automatically when SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY
 * aren't configured (see createUploadsRepository) — this is what makes the
 * upload flow testable locally (`wrangler dev` or plain Node) without a real
 * Supabase project. Not suitable for production: a Worker can run multiple
 * isolates, so in-memory state isn't reliably shared across requests there.
 */
export class InMemoryUploadsRepository implements UploadsRepository {
  private readonly uploadsById = new Map<string, Upload>()

  async create(upload: Upload): Promise<Upload> {
    this.uploadsById.set(upload.id, upload)
    return upload
  }

  async findById(id: string): Promise<Upload | null> {
    return this.uploadsById.get(id) ?? null
  }

  async findByUserAndFilename(userId: string, fileName: string): Promise<Upload | null> {
    for (const upload of this.uploadsById.values()) {
      if (upload.userId === userId && upload.originalFileName === fileName) return upload
    }
    return null
  }
}
