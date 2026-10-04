import type { Env } from '../env'
import type { UserPlan } from '../types'
import type { UploadsRepository } from '../repositories/UploadsRepository'
import type { JobsRepository } from '../repositories/JobsRepository'
import { createUploadsRepository } from '../repositories/createUploadsRepository'
import { createJobsRepository } from '../repositories/createJobsRepository'
import { PLAN_LIMITS, UPLOAD_RETENTION_DAYS } from '../config'
import { QuotaExceededError, RateLimitedError } from '../errors'

const TEN_MINUTES_MS = 10 * 60 * 1000
const DAY_MS = 24 * 60 * 60 * 1000
/** Retry-After for the concurrency limit: a typical conversion takes seconds. */
const ACTIVE_JOBS_RETRY_SECONDS = 30

/**
 * Per-user abuse limits, checked against the database (authoritative, the
 * same in every isolate and region): uploads per rolling 10 minutes and per
 * rolling day, the stored-bytes quota, and concurrent conversions.
 *
 * Checks read counts before the write they guard, so concurrent requests
 * from one user can overshoot a limit by at most their own concurrency; the
 * limits exist to stop sustained abuse, not to meter exactly. An optional
 * Cloudflare Rate Limiting binding (index.ts, API_RATE_LIMITER) throttles
 * request bursts per client IP before any of this runs.
 */
export class UsageLimitsService {
  constructor(
    private readonly uploads: UploadsRepository,
    private readonly jobs: JobsRepository,
  ) {}

  /** Before accepting an upload's body: rate and concurrency limits. */
  async assertCanStartUpload(userId: string, plan: UserPlan, now: number = Date.now()): Promise<void> {
    const limits = PLAN_LIMITS[plan]
    const [lastTenMinutes, lastDay] = await Promise.all([
      this.uploads.countByUserSince(userId, new Date(now - TEN_MINUTES_MS).toISOString()),
      this.uploads.countByUserSince(userId, new Date(now - DAY_MS).toISOString()),
    ])
    if (lastTenMinutes >= limits.uploadsPerTenMinutes) {
      throw new RateLimitedError(`Upload limit reached: ${limits.uploadsPerTenMinutes} uploads per 10 minutes`, 10 * 60)
    }
    if (lastDay >= limits.uploadsPerDay) {
      throw new RateLimitedError(`Upload limit reached: ${limits.uploadsPerDay} uploads per day`, 60 * 60)
    }
    await this.assertCanStartJob(userId, plan)
  }

  /** Once the file size is known, before it is stored: the storage quota. */
  async assertStorageAvailable(userId: string, plan: UserPlan, incomingBytes: number): Promise<void> {
    const quota = PLAN_LIMITS[plan].storageQuotaBytes
    const stored = await this.uploads.storedBytesByUser(userId)
    if (stored + incomingBytes > quota) {
      throw new QuotaExceededError(
        `Storage quota reached (${Math.round(quota / (1024 * 1024))} MB). Uploads are deleted ${UPLOAD_RETENTION_DAYS} days after upload, which frees space.`,
      )
    }
  }

  /** Before creating a conversion job: concurrent-conversion limit. */
  async assertCanStartJob(userId: string, plan: UserPlan): Promise<void> {
    const max = PLAN_LIMITS[plan].maxActiveJobs
    if ((await this.jobs.countActiveByUser(userId)) >= max) {
      throw new RateLimitedError(`Too many conversions in progress (limit ${max}); try again when one finishes`, ACTIVE_JOBS_RETRY_SECONDS)
    }
  }
}

export function createUsageLimitsService(env: Env): UsageLimitsService {
  return new UsageLimitsService(createUploadsRepository(env), createJobsRepository(env))
}
