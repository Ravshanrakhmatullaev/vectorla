import type { Env } from '../env'
import type { UploadsRepository } from '../repositories/UploadsRepository'
import type { JobsRepository } from '../repositories/JobsRepository'
import type { ConversionsRepository } from '../repositories/ConversionsRepository'
import { StorageService } from './StorageService'
import { createUploadsRepository } from '../repositories/createUploadsRepository'
import { createJobsRepository } from '../repositories/createJobsRepository'
import { createConversionsRepository } from '../repositories/createConversionsRepository'
import { createR2Client } from '../integrations/r2'
import { RETENTION_PURGE_BATCH_SIZE, UPLOAD_RETENTION_DAYS } from '../config'

const DAY_MS = 24 * 60 * 60 * 1000

export interface RetentionResult {
  /** Uploads deleted together with their jobs, conversions and stored files. */
  purged: number
  /** Expired uploads left for a later run (an active job, or a deletion error). */
  skipped: number
}

/**
 * Deletes uploaded images and every result traced from them once they are
 * older than UPLOAD_RETENTION_DAYS (the period stated in the Privacy Policy).
 *
 * Per upload: stored files go first (the original and every conversion),
 * then the upload row, which cascades to its jobs and conversions in the
 * database. In that order a failure part-way leaves a row whose files are
 * already gone, and the next run simply retries; the reverse order could
 * leave stored files that no row points to any more. Credit history is kept
 * (ledger rows lose their job link, see schema.sql).
 */
export class RetentionService {
  constructor(
    private readonly uploads: UploadsRepository,
    private readonly jobs: JobsRepository,
    private readonly conversions: ConversionsRepository,
    private readonly storage: StorageService,
  ) {}

  async purgeExpired(now: number = Date.now(), limit = RETENTION_PURGE_BATCH_SIZE): Promise<RetentionResult> {
    const cutoff = new Date(now - UPLOAD_RETENTION_DAYS * DAY_MS).toISOString()
    const expired = await this.uploads.findCreatedBefore(cutoff, limit)
    let purged = 0
    let skipped = 0

    for (const upload of expired) {
      try {
        const jobs = await this.jobs.findByUploadId(upload.id)
        // Never pull files out from under a running job; the stale-job sweep
        // ends it, and the next retention run deletes it.
        if (jobs.some((job) => job.status === 'queued' || job.status === 'processing')) {
          skipped++
          continue
        }
        const conversions = jobs.length ? await this.conversions.findByJobIds(jobs.map((job) => job.id), upload.userId) : []
        for (const conversion of conversions) await this.storage.deleteFile(conversion.storageKey)
        await this.storage.deleteFile(upload.storageKey)
        await this.uploads.delete(upload.id)
        purged++
      } catch (error) {
        skipped++
        console.error(`Retention: failed to purge upload ${upload.id}:`, error)
      }
    }
    return { purged, skipped }
  }
}

export function createRetentionService(env: Env): RetentionService {
  return new RetentionService(
    createUploadsRepository(env),
    createJobsRepository(env),
    createConversionsRepository(env),
    new StorageService(createR2Client(env.UPLOADS_BUCKET), env.DOWNLOAD_URL_SECRET),
  )
}
