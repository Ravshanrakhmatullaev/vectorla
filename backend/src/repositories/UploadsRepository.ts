import type { Upload } from '../types'

export interface UploadsRepository {
  /** Throws ConflictError if (userId, originalFileName) already exists — see implementations for how the race is closed. */
  create(upload: Upload): Promise<Upload>
  findById(id: string): Promise<Upload | null>
  findByUserAndFilename(userId: string, fileName: string): Promise<Upload | null>
  /** Used by OrphanCleanupService to cross-reference DB rows against R2 — not paginated, fine for today's scale. */
  listAll(): Promise<Upload[]>
}
