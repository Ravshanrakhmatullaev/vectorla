import type { Conversion } from '../types'

export interface ConversionsRepository {
  create(conversion: Conversion): Promise<Conversion>
  findById(id: string): Promise<Conversion | null>
  /** Today's pipeline (see ConversionService.processJob) produces exactly one Conversion per Job. */
  findByJobId(jobId: string): Promise<Conversion | null>
  findByJobIds(jobIds: string[], userId: string): Promise<Conversion[]>
  findByUserId(userId: string): Promise<Conversion[]>
  /** Used by routes/download.ts to resolve a signed download URL's R2 key back to its Conversion row. */
  findByStorageKey(storageKey: string): Promise<Conversion | null>
  /** Used by OrphanCleanupService to cross-reference DB rows against R2 — not paginated, fine for today's scale. */
  listAll(): Promise<Conversion[]>
}
