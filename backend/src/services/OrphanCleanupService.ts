import type { Upload, Conversion } from '../types'
import type { Env } from '../env'
import type { R2Client } from '../integrations/r2'
import type { UploadsRepository } from '../repositories/UploadsRepository'
import type { ConversionsRepository } from '../repositories/ConversionsRepository'
import { createR2Client } from '../integrations/r2'
import { createUploadsRepository } from '../repositories/createUploadsRepository'
import { createConversionsRepository } from '../repositories/createConversionsRepository'

export interface OrphanReport {
  /** R2 keys under uploads/ or conversions/ with no matching database row. */
  orphanedR2Keys: string[]
  /** Upload rows whose storageKey doesn't exist in R2 (write failed/partial, or the object was deleted out-of-band). */
  uploadsMissingR2Object: Upload[]
  /** Conversion rows whose storageKey doesn't exist in R2. */
  conversionsMissingR2Object: Conversion[]
}

/**
 * Detects (but never fixes) the two orphan shapes documented in
 * backend/README.md's "Known limitations": an R2 object with no database
 * row (e.g. UploadService's storeFile succeeded but the Supabase insert
 * failed right after), and a database row whose R2 object never — or no
 * longer — exists.
 *
 * Deliberately not wired to any cron/queue trigger (Phase 18 scope:
 * "do not implement scheduled cleanup workers") — this is the detection
 * logic a future scheduled worker would call, or that an operator can run
 * by hand today. It only reports; deleting orphaned R2 objects or flagging
 * DB rows is a follow-up decision (e.g. how long to wait before treating an
 * orphan as safe to delete, since a slow-in-flight upload can look orphaned
 * for a few seconds) that's out of scope here.
 */
export class OrphanCleanupService {
  constructor(
    private readonly r2: R2Client,
    private readonly uploads: UploadsRepository,
    private readonly conversions: ConversionsRepository,
  ) {}

  async detectOrphans(): Promise<OrphanReport> {
    const [uploadRows, conversionRows, uploadKeys, conversionKeys] = await Promise.all([
      this.uploads.listAll(),
      this.conversions.listAll(),
      this.r2.list('uploads/'),
      this.r2.list('conversions/'),
    ])

    const uploadKeysInDb = new Set(uploadRows.map((upload) => upload.storageKey))
    const conversionKeysInDb = new Set(conversionRows.map((conversion) => conversion.storageKey))

    const orphanedR2Keys = [
      ...uploadKeys.filter((key) => !uploadKeysInDb.has(key)),
      ...conversionKeys.filter((key) => !conversionKeysInDb.has(key)),
    ]

    const allR2Keys = new Set([...uploadKeys, ...conversionKeys])
    const uploadsMissingR2Object = uploadRows.filter((upload) => !allR2Keys.has(upload.storageKey))
    const conversionsMissingR2Object = conversionRows.filter((conversion) => !allR2Keys.has(conversion.storageKey))

    return { orphanedR2Keys, uploadsMissingR2Object, conversionsMissingR2Object }
  }
}

export function createOrphanCleanupService(env: Env): OrphanCleanupService {
  const r2 = createR2Client(env.UPLOADS_BUCKET)
  const uploads = createUploadsRepository(env)
  const conversions = createConversionsRepository(env)
  return new OrphanCleanupService(r2, uploads, conversions)
}
