import type { Job } from '../types'
import type { Env } from '../env'
import { QueueService } from './QueueService'
import { createQueueClient } from '../integrations/queue'
import { createJobsRepository } from '../repositories/createJobsRepository'
import { createUploadsRepository } from '../repositories/createUploadsRepository'
import type { JobsRepository } from '../repositories/JobsRepository'
import type { UploadsRepository } from '../repositories/UploadsRepository'
import { NotFoundError, ValidationError } from '../errors'

export interface CreateJobInput {
  userId: string
  uploadId: string
  preset?: string
  settings?: Record<string, number>
}

export class JobService {
  constructor(
    private readonly repository: JobsRepository,
    private readonly uploads: UploadsRepository,
    private readonly queueService: QueueService,
  ) {}

  /** Creates a job for an existing upload, persists it, and enqueues it for processing. */
  async createJob(input: CreateJobInput): Promise<Job> {
    const upload = await this.uploads.findById(input.uploadId)
    if (!upload) {
      throw new ValidationError(`No upload found with id "${input.uploadId}"`)
    }
    if (upload.userId !== input.userId) {
      throw new ValidationError(`Upload "${input.uploadId}" does not belong to user "${input.userId}"`)
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
  // AI runs here yet — this only exercises queued -> processing -> completed. ---

  async markProcessing(jobId: string): Promise<Job> {
    const job = await this.getJob(jobId)
    return this.repository.update({
      ...job,
      status: 'processing',
      updatedAt: new Date().toISOString(),
    })
  }

  async markCompleted(jobId: string): Promise<Job> {
    const job = await this.getJob(jobId)
    const now = new Date().toISOString()
    return this.repository.update({
      ...job,
      status: 'completed',
      updatedAt: now,
      completedAt: now,
    })
  }

  async markFailed(jobId: string, errorMessage: string): Promise<Job> {
    const job = await this.getJob(jobId)
    return this.repository.update({
      ...job,
      status: 'failed',
      errorMessage,
      retryCount: job.retryCount + 1,
      updatedAt: new Date().toISOString(),
    })
  }
}

export function createJobService(env: Env): JobService {
  const repository = createJobsRepository(env)
  const uploads = createUploadsRepository(env)
  const queueClient = createQueueClient(env.CONVERSION_QUEUE)
  const queueService = new QueueService(queueClient)
  return new JobService(repository, uploads, queueService)
}
