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
import { CreditsService, createCreditsService, calculateRequiredCredits } from './CreditsService'
import { NotFoundError, ConflictError } from '../errors'

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
    private readonly credits: CreditsService,
  ) {}

  /**
   * Runs the conversion pipeline for a queued job: load job + upload, mark
   * processing, verify the user can cover the credit cost (see
   * CreditsService.ensureEnoughCredits — throwing here leaves the job for
   * the Worker's queue() consumer to mark 'failed' with a clear message,
   * same as any other processing error), vectorize via the configured
   * provider (see providers/ProviderFactory.ts — only PlaceholderProvider
   * actually works today), store the result in R2, save the Conversion row,
   * debit the credits, then mark the job completed.
   *
   * Idempotent against queue redelivery: a message for an already-completed
   * job returns the existing conversion(s) as a no-op (no re-vectorizing, no
   * double debit); a message for a job that's already 'processing' throws
   * ConflictError so the caller (see index.ts's queue() consumer) can treat
   * it as "another delivery is already handling this" rather than a real
   * failure. markProcessing()'s own optimistic lock (see JobsRepository)
   * closes the remaining race if two deliveries pass this check at once.
   */
  async processJob(jobId: string): Promise<Conversion[]> {
    const job = await this.jobs.getJob(jobId)

    if (job.status === 'completed') {
      const existing = await this.conversions.findByJobId(jobId)
      return existing ? [existing] : []
    }
    if (job.status === 'processing') {
      throw new ConflictError(`Job "${jobId}" is already being processed`)
    }

    const upload = await this.uploads.findById(job.uploadId)
    if (!upload) {
      throw new NotFoundError(`No upload found with id "${job.uploadId}"`)
    }

    await this.jobs.markProcessing(job.id)

    // TODO(backend): formatCount/printReady are hardcoded until Job carries
    // the caller's requested formats/print-ready flag — see calculateRequiredCredits.
    const requiredCredits = calculateRequiredCredits(1, false)
    await this.credits.ensureEnoughCredits(job.userId, requiredCredits)

    const fileStream = await this.storage.getFile(upload.storageKey)
    const fileBytes = await new Response(fileStream).arrayBuffer()
    const result = await this.provider.vectorize(upload, fileBytes, job.preset)
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

    // NOTE: if this debit fails after the conversion row above was already
    // created, the job is left for the queue consumer to mark 'failed' with
    // that error — same "no rollback on partial failure" trade-off as
    // UploadService's R2-then-Supabase write (see backend/README.md).
    await this.credits.debitCredits(job.userId, requiredCredits, `Conversion for job "${job.id}"`, job.id)

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
  const credits = createCreditsService(env)
  return new ConversionService(jobs, uploads, storage, conversions, provider, credits)
}
