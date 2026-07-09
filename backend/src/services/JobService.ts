import type { Job } from '../types'
import type { Env } from '../env'
import { QueueService } from './QueueService'
import { createQueueClient } from '../integrations/queue'
import { createJobsRepository } from '../repositories/createJobsRepository'
import { createUploadsRepository } from '../repositories/createUploadsRepository'
import type { JobsRepository } from '../repositories/JobsRepository'
import type { UploadsRepository } from '../repositories/UploadsRepository'
import { CreditsService, createCreditsService } from './CreditsService'
import { NotFoundError, ValidationError, ForbiddenError } from '../errors'

export interface CreateJobInput {
  userId: string
  uploadId: string
  preset?: string
  settings?: Record<string, number>
  /**
   * Phase 26: id of a completed job for the same upload that this job
   * replaces (e.g. switching Quick Trace -> Professional Trace after Quick
   * already finished). If that job was billed, its debit is refunded before
   * this new job is created — so re-choosing how an upload is traced is
   * never additive on top of a prior charge. Ignored if the referenced job
   * doesn't belong to the caller, isn't for this upload, or isn't completed.
   */
  supersedesJobId?: string
}

export class JobService {
  constructor(
    private readonly repository: JobsRepository,
    private readonly uploads: UploadsRepository,
    private readonly queueService: QueueService,
    // Optional so existing call sites (and JobService's own smoke test) that
    // never pass a supersedesJobId don't need to wire this up.
    private readonly credits?: CreditsService,
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
      throw new ForbiddenError(`Upload "${input.uploadId}" does not belong to user "${input.userId}"`)
    }

    const active = await this.repository.findActiveByUploadId(input.uploadId)
    if (active) return active

    if (input.supersedesJobId && this.credits) {
      const superseded = await this.repository.findById(input.supersedesJobId)
      if (
        superseded &&
        superseded.userId === input.userId &&
        superseded.uploadId === input.uploadId &&
        superseded.status === 'completed'
      ) {
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

    const created = await this.repository.create(job)
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

  async markCompleted(jobId: string): Promise<Job> {
    const job = await this.getJob(jobId)
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
  return new JobService(repository, uploads, queueService, credits)
}
