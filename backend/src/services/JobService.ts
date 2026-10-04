import type { Job, UserPlan } from '../types'
import type { Env } from '../env'
import { QueueService } from './QueueService'
import { createQueueClient } from '../integrations/queue'
import { createJobsRepository } from '../repositories/createJobsRepository'
import { createUploadsRepository } from '../repositories/createUploadsRepository'
import type { JobsRepository } from '../repositories/JobsRepository'
import type { UploadsRepository } from '../repositories/UploadsRepository'
import type { ConversionsRepository } from '../repositories/ConversionsRepository'
import { createConversionsRepository } from '../repositories/createConversionsRepository'
import { createR2Client } from '../integrations/r2'
import { StorageService } from './StorageService'
import { UsageLimitsService, createUsageLimitsService } from './UsageLimitsService'
import { CreditsService, createCreditsService } from './CreditsService'
import { NotFoundError, ValidationError, ForbiddenError, ConflictError, JobLeaseHeldError } from '../errors'
import { JOB_LEASE_MS } from '../config'

export interface CreateJobInput {
  userId: string
  uploadId: string
  preset?: string
  settings?: Record<string, number>
  /**
   * Phase 26: id of a completed job for the same upload that this job
   * replaces (e.g. switching Quick Trace -> Professional Trace after Quick
   * already finished). Its result is deleted (file, then row) and its debit
   * refunded before this new job is created, so re-choosing how an upload is
   * traced is never additive on top of a prior charge, and a refunded result
   * can no longer be downloaded. Ignored if the referenced job doesn't
   * belong to the caller, isn't for this upload, or isn't completed.
   */
  supersedesJobId?: string
  /** When set (POST /jobs), the plan's concurrent-conversion limit is enforced for a new job. */
  plan?: UserPlan
}

export class JobService {
  constructor(
    private readonly repository: JobsRepository,
    private readonly uploads: UploadsRepository,
    private readonly queueService: QueueService,
    // Optional so existing call sites (and JobService's own smoke test) that
    // never pass a supersedesJobId don't need to wire this up. Superseding is
    // honored only when all three are present: a refund without removing the
    // refunded result would make that result free.
    private readonly credits?: CreditsService,
    private readonly conversions?: ConversionsRepository,
    private readonly storage?: StorageService,
    private readonly limits?: UsageLimitsService,
  ) {}

  /**
   * Creates a job for an existing upload, persists it, and enqueues it for
   * processing. If the upload already has an active (queued/processing) job,
   * that job is returned unchanged instead of creating a duplicate — an
   * accidental double-submit (double-click, client retry) is a no-op rather
   * than a second conversion/second credit debit. A new job can still be
   * created once the prior one finishes (completed or failed).
   */
  async createJob(input: CreateJobInput): Promise<Job> {
    const upload = await this.uploads.findById(input.uploadId)
    if (!upload) {
      throw new ValidationError(`No upload found with id "${input.uploadId}"`)
    }
    if (upload.userId !== input.userId) {
      throw new ForbiddenError('You do not have access to this upload')
    }

    const active = await this.repository.findActiveByUploadId(input.uploadId)
    if (active) return active
    if (input.plan && this.limits) await this.limits.assertCanStartJob(input.userId, input.plan)

    if (input.supersedesJobId && this.credits && this.conversions && this.storage) {
      const superseded = await this.repository.findById(input.supersedesJobId)
      if (
        superseded &&
        superseded.userId === input.userId &&
        superseded.uploadId === input.uploadId &&
        superseded.status === 'completed'
      ) {
        // Result first, refund second: if the refund fails the request
        // fails and a retry refunds (idempotently); the reverse order could
        // leave a refunded result still downloadable.
        const result = await this.conversions.findByJobId(superseded.id)
        if (result && result.userId === input.userId) {
          await this.storage.deleteFile(result.storageKey)
          await this.conversions.delete(result.id)
        }
        await this.credits.refundJobDebit(input.userId, superseded.id, `Superseded by a new trace of upload "${input.uploadId}"`)
      }
    }

    const now = new Date().toISOString()
    const job: Job = {
      id: crypto.randomUUID(),
      userId: input.userId,
      uploadId: input.uploadId,
      status: 'queued',
      preset: input.preset ?? null,
      settings: input.settings ?? null,
      errorMessage: null,
      retryCount: 0,
      version: 0,
      createdAt: now,
      updatedAt: now,
      completedAt: null,
    }

    let created: Job
    try {
      created = await this.repository.create(job)
    } catch (error) {
      // A concurrent request created the active job first (unique index).
      if (!(error instanceof ConflictError)) throw error
      const winner = await this.repository.findActiveByUploadId(input.uploadId)
      if (winner) return winner
      throw error
    }
    await this.queueService.enqueueConversionJob(created)
    return created
  }

  async getJob(jobId: string): Promise<Job> {
    const job = await this.repository.findById(jobId)
    if (!job) throw new NotFoundError(`No job found with id "${jobId}"`)
    return job
  }

  // --- Queue-consumer state transitions (see index.ts's queue() handler). No
  // AI runs here yet — this only exercises queued -> processing -> completed.
  // Each transition is optimistically locked (see JobsRepository.update) so
  // two concurrent deliveries of the same queue message can't both "win". ---

  async markProcessing(jobId: string): Promise<Job> {
    const job = await this.getJob(jobId)
    return this.repository.update(job, {
      ...job,
      status: 'processing',
      version: job.version + 1,
      updatedAt: new Date().toISOString(),
    })
  }

  /**
   * Claims a job for this delivery. A queued job is claimed outright; a
   * processing job whose lease (updatedAt + JOB_LEASE_MS) is still live
   * belongs to another delivery — JobLeaseHeldError tells the consumer to
   * check back after the lease; an expired lease is taken over (the worker
   * holding it died). Optimistic locking makes concurrent claims safe: the
   * loser gets ConflictError.
   */
  async claimForProcessing(job: Job, now: number = Date.now()): Promise<Job> {
    if (job.status === 'processing') {
      const leaseEnds = Date.parse(job.updatedAt) + JOB_LEASE_MS
      if (leaseEnds > now) throw new JobLeaseHeldError(job.id, Math.ceil((leaseEnds - now) / 1000))
      console.warn(`Taking over job "${job.id}": processing lease expired (worker likely crashed)`)
    }
    return this.repository.update(job, {
      ...job,
      status: 'processing',
      version: job.version + 1,
      updatedAt: new Date(now).toISOString(),
    })
  }

  /** After a transient failure: back to 'queued' (not failed) so the retry can claim it. */
  async releaseAfterError(jobId: string, errorMessage: string): Promise<Job> {
    const job = await this.getJob(jobId)
    if (job.status !== 'processing') return job
    return this.repository.update(job, {
      ...job,
      status: 'queued',
      errorMessage,
      retryCount: job.retryCount + 1,
      version: job.version + 1,
      updatedAt: new Date().toISOString(),
    })
  }

  findStaleJobs(status: 'queued' | 'processing', olderThanMs: number, limit = 50, now: number = Date.now()): Promise<Job[]> {
    return this.repository.findStale(status, new Date(now - olderThanMs).toISOString(), limit)
  }

  async markCompleted(jobId: string): Promise<Job> {
    const job = await this.getJob(jobId)
    // A job the sweeper or dead-letter queue already failed (and refunded)
    // must not flip back to completed: the user would keep the result free.
    if (job.status === 'failed') throw new ConflictError(`Job "${jobId}" already failed — not marking it completed`)
    const now = new Date().toISOString()
    return this.repository.update(job, {
      ...job,
      status: 'completed',
      version: job.version + 1,
      updatedAt: now,
      completedAt: now,
    })
  }

  async markFailed(jobId: string, errorMessage: string): Promise<Job> {
    const job = await this.getJob(jobId)
    // A completed job stays completed (failJob would otherwise refund a delivered result).
    if (job.status === 'completed') throw new ConflictError(`Job "${jobId}" already completed — not marking it failed`)
    return this.repository.update(job, {
      ...job,
      status: 'failed',
      errorMessage,
      retryCount: job.retryCount + 1,
      version: job.version + 1,
      updatedAt: new Date().toISOString(),
    })
  }
}

export function createJobService(env: Env): JobService {
  const repository = createJobsRepository(env)
  const uploads = createUploadsRepository(env)
  const queueClient = createQueueClient(env.CONVERSION_QUEUE)
  const queueService = new QueueService(queueClient)
  const credits = createCreditsService(env)
  const storage = new StorageService(createR2Client(env.UPLOADS_BUCKET), env.DOWNLOAD_URL_SECRET)
  return new JobService(repository, uploads, queueService, credits, createConversionsRepository(env), storage, createUsageLimitsService(env))
}
