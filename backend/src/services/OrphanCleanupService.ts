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
 * A one-shot report for operators (it lists the whole bucket and every
 * row). The scheduled deletion is OrphanSweeper below, which works one
 * shard at a time and leaves recent objects alone.
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

export interface OrphanSweepResult {
  prefix: string
  scanned: number
  deleted: number
}

/** Objects younger than this are never deleted: an upload's R2 write lands before its database row. */
export const ORPHAN_GRACE_MS = 24 * 60 * 60 * 1000
const HEX = '0123456789abcdef'
/** uploads/ and conversions/, each split by the first hex digit of the user id: 32 shards. */
export const ORPHAN_SHARD_COUNT = 2 * HEX.length
const MAX_PAGES_PER_SWEEP = 5

/** The R2 prefix a shard covers. User ids are UUIDs, so every key falls in exactly one shard. */
export function orphanShardPrefix(shard: number): string {
  const index = ((shard % ORPHAN_SHARD_COUNT) + ORPHAN_SHARD_COUNT) % ORPHAN_SHARD_COUNT
  return `${index < HEX.length ? 'uploads' : 'conversions'}/${HEX[index % HEX.length]}`
}

/**
 * Deletes R2 objects with no database row (the "orphans" detectOrphans
 * reports): an original whose upload row insert failed, a result whose
 * conversion row was never written, or files whose rows were removed
 * without them. Run from the cron trigger one shard at a time, so the whole
 * bucket is covered every 32 runs (8 hours at the 15-minute cron) without
 * listing it all at once; objects younger than ORPHAN_GRACE_MS are skipped.
 */
export class OrphanSweeper {
  constructor(
    private readonly r2: R2Client,
    private readonly uploads: UploadsRepository,
    private readonly conversions: ConversionsRepository,
  ) {}

  async sweep(shard: number, now: number = Date.now()): Promise<OrphanSweepResult> {
    const prefix = orphanShardPrefix(shard)
    const rows = prefix.startsWith('uploads/') ? this.uploads : this.conversions
    let cursor: string | undefined
    let scanned = 0
    let deleted = 0
    for (let page = 0; page < MAX_PAGES_PER_SWEEP; page++) {
      const listed = await this.r2.listPage(prefix, cursor)
      scanned += listed.objects.length
      const old = listed.objects.filter((object) => now - object.uploaded.getTime() > ORPHAN_GRACE_MS).map((object) => object.key)
      if (old.length > 0) {
        const kept = await rows.findExistingStorageKeys(old)
        for (const key of old) {
          if (kept.has(key)) continue
          await this.r2.delete(key)
          deleted++
        }
      }
      cursor = listed.cursor
      if (!cursor) break
    }
    return { prefix, scanned, deleted }
  }
}

/** The shard a cron run at `now` sweeps: one per 15-minute slot. */
export function orphanShardFor(now: number): number {
  return Math.floor(now / (15 * 60 * 1000)) % ORPHAN_SHARD_COUNT
}

export function createOrphanSweeper(env: Env): OrphanSweeper {
  return new OrphanSweeper(createR2Client(env.UPLOADS_BUCKET), createUploadsRepository(env), createConversionsRepository(env))
}

export function createOrphanCleanupService(env: Env): OrphanCleanupService {
  const r2 = createR2Client(env.UPLOADS_BUCKET)
  const uploads = createUploadsRepository(env)
  const conversions = createConversionsRepository(env)
  return new OrphanCleanupService(r2, uploads, conversions)
}
