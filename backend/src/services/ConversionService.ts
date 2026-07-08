import type { Conversion, JobStatus } from '../types'
import type { Env } from '../env'
import { JobService, createJobService } from './JobService'
import { StorageService } from './StorageService'
import { createR2Client } from '../integrations/r2'
import { createUploadsRepository } from '../repositories/createUploadsRepository'
import { createConversionsRepository } from '../repositories/createConversionsRepository'
import type { UploadsRepository } from '../repositories/UploadsRepository'
import type { ConversionsRepository } from '../repositories/ConversionsRepository'
import type { VectorizationProvider } from '../providers/VectorizationProvider'
import { createVectorizationProvider } from '../providers/ProviderFactory'
import { NotFoundError } from '../errors'

/** Result of looking up a job's conversion — see ConversionService.getConversionByJob. */
export interface ConversionByJobResult {
  /** The job's owner — always populated, so routes can do an ownership check regardless of job status. */
  userId: string
  jobStatus: JobStatus
  conversion: Conversion | null
  /** Only populated when jobStatus is 'failed' (mirrors Job.errorMessage). */
  errorMessage: string | null
}

export class ConversionService {
  constructor(
    private readonly jobs: JobService,
    private readonly uploads: UploadsRepository,
    private readonly storage: StorageService,
    private readonly conversions: ConversionsRepository,
    private readonly provider: VectorizationProvider,
  ) {}

  /**
   * Runs the conversion pipeline for a queued job: load job + upload, mark
   * processing, vectorize via the configured provider (see
   * providers/ProviderFactory.ts — only PlaceholderProvider actually works
   * today), store the result in R2, save the Conversion row, then mark the
   * job completed. Called by the Worker's queue() consumer (see index.ts)
   * once per queue message.
   */
  async processJob(jobId: string): Promise<Conversion[]> {
    const job = await this.jobs.getJob(jobId)
    const upload = await this.uploads.findById(job.uploadId)
    if (!upload) {
      throw new NotFoundError(`No upload found with id "${job.uploadId}"`)
    }

    await this.jobs.markProcessing(job.id)

    const result = await this.provider.vectorize(upload)
    const storageKey = `conversions/${job.userId}/${job.id}/output.${result.format}`
    await this.storage.storeFile(storageKey, result.data)

    const conversion: Conversion = {
      id: crypto.randomUUID(),
      jobId: job.id,
      userId: job.userId,
      format: result.format,
      storageKey,
      fileSizeBytes: result.data.byteLength,
      downloadUrl: null,
      createdAt: new Date().toISOString(),
    }
    const created = await this.conversions.create(conversion)

    await this.jobs.markCompleted(job.id)

    return [created]
  }

  /** GET /api/conversions/:id — a Conversion row only ever exists for a completed job, so a download URL is always attached. */
  async getConversion(conversionId: string): Promise<Conversion> {
    const conversion = await this.conversions.findById(conversionId)
    if (!conversion) throw new NotFoundError(`No conversion found with id "${conversionId}"`)
    return this.attachDownloadUrl(conversion)
  }

  /**
   * GET /api/jobs/:id/conversion — resolves the job's current state into a
   * shape the route can map straight to an HTTP status: queued/processing
   * (still working), completed (conversion + download URL attached), or
   * failed (error information, no conversion).
   */
  async getConversionByJob(jobId: string): Promise<ConversionByJobResult> {
    const job = await this.jobs.getJob(jobId)

    if (job.status === 'failed') {
      return { userId: job.userId, jobStatus: 'failed', conversion: null, errorMessage: job.errorMessage }
    }
    if (job.status !== 'completed') {
      return { userId: job.userId, jobStatus: job.status, conversion: null, errorMessage: null }
    }

    const conversion = await this.conversions.findByJobId(jobId)
    if (!conversion) {
      // Shouldn't happen given processJob's pipeline (the conversion row is
      // created before the job is marked completed), but a missing row is
      // exactly as unavailable to the caller as a missing job would be.
      throw new NotFoundError(`No conversion found for completed job "${jobId}"`)
    }
    return {
      userId: job.userId,
      jobStatus: 'completed',
      conversion: await this.attachDownloadUrl(conversion),
      errorMessage: null,
    }
  }

  /** Lists a user's completed conversions, most recent first, each with a fresh download URL. */
  async listUserConversions(userId: string): Promise<Conversion[]> {
    const conversions = await this.conversions.findByUserId(userId)
    return Promise.all(conversions.map((conversion) => this.attachDownloadUrl(conversion)))
  }

  private async attachDownloadUrl(conversion: Conversion): Promise<Conversion> {
    const downloadUrl = await this.storage.getSignedDownloadUrl(conversion.storageKey)
    return { ...conversion, downloadUrl }
  }
}

export function createConversionService(env: Env): ConversionService {
  const jobs = createJobService(env)
  const uploads = createUploadsRepository(env)
  const r2 = createR2Client(env.UPLOADS_BUCKET)
  const storage = new StorageService(r2, env.DOWNLOAD_URL_SECRET)
  const conversions = createConversionsRepository(env)
  const provider = createVectorizationProvider(env)
  return new ConversionService(jobs, uploads, storage, conversions, provider)
}
