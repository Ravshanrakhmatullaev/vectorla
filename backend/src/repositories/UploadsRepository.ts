import type { Upload } from '../types'

export interface UploadsRepository {
  /** Throws ConflictError if (userId, originalFileName) already exists — see implementations for how the race is closed. */
  create(upload: Upload): Promise<Upload>
  /** Which of these storage keys have a row — the orphan sweep deletes R2 objects without one. */
  findExistingStorageKeys(keys: string[]): Promise<Set<string>>
  findById(id: string): Promise<Upload | null>
  /** Uploads by a user created at or after `since` (ISO) — upload rate limits. */
  countByUserSince(userId: string, since: string): Promise<number>
  /** Total bytes of a user's stored uploads (retention keeps 30 days of them) — storage quota. */
  storedBytesByUser(userId: string): Promise<number>
  findByUserAndFilename(userId: string, fileName: string): Promise<Upload | null>
  /** Used by OrphanCleanupService to cross-reference DB rows against R2 — not paginated, fine for today's scale. */
  listAll(): Promise<Upload[]>
  /** Oldest first: uploads created before `before` (ISO timestamp). */
  findCreatedBefore(before: string, limit: number): Promise<Upload[]>
  /**
   * Deletes the upload row. In Supabase this cascades to its jobs and
   * conversions (schema.sql); credit ledger rows survive with job_id = null.
   */
  delete(id: string): Promise<void>
}
