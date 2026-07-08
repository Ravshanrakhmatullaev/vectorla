import type { Upload } from '../types'
import type { UploadsRepository } from './UploadsRepository'
import { ConflictError } from '../errors'

/**
 * In-memory fallback used automatically when SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY
 * aren't configured (see createUploadsRepository) — this is what makes the
 * upload flow testable locally (`wrangler dev` or plain Node) without a real
 * Supabase project. Not suitable for production: a Worker can run multiple
 * isolates, so in-memory state isn't reliably shared across requests there.
 */
export class InMemoryUploadsRepository implements UploadsRepository {
  private readonly uploadsById = new Map<string, Upload>()

  /** Enforces the (userId, originalFileName) uniqueness atomically — see UploadsRepository.create. */
  async create(upload: Upload): Promise<Upload> {
    for (const existing of this.uploadsById.values()) {
      if (existing.userId === upload.userId && existing.originalFileName === upload.originalFileName) {
        throw new ConflictError(`A file named "${upload.originalFileName}" has already been uploaded`)
      }
    }
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

  async listAll(): Promise<Upload[]> {
    return Array.from(this.uploadsById.values())
  }
}
