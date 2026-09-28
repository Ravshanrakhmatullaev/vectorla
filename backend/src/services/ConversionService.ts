import type { Conversion, JobStatus, Upload } from '../types'
import type { Env } from '../env'
import { JobService, createJobService } from './JobService'
import { StorageService } from './StorageService'
import { createR2Client } from '../integrations/r2'
import { createUploadsRepository } from '../repositories/createUploadsRepository'
import { createConversionsRepository } from '../repositories/createConversionsRepository'
import type { UploadsRepository } from '../repositories/UploadsRepository'
import type { ConversionsRepository } from '../repositories/ConversionsRepository'
import { decodeImage, type RasterDecoderWasm } from '../providers/imageDecoder'
import type { VectorizationResult } from '../providers/VectorizationProvider'
import { createProviderByName } from '../providers/ProviderFactory'
import { ImageAnalysisService, createImageAnalysisService } from './ImageAnalysisService'
import {
  runProfessionalTrace,
  PROFESSIONAL_TRACE_JOB_PRESET,
  PROFESSIONAL_TRACE_CREDIT_MULTIPLIER,
} from '../pipeline/ProfessionalTracePipeline'
import { CreditsService, createCreditsService, calculateRequiredCredits } from './CreditsService'
import { sourceFormatFromMime } from '../engine/profiles'
import { NotFoundError, NotImplementedError, InsufficientCreditsError, PayloadTooLargeError, UnsupportedMediaTypeError, ValidationError } from '../errors'

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
    private readonly imageAnalysis: ImageAnalysisService,
    private readonly decoderWasm: RasterDecoderWasm,
    private readonly credits: CreditsService,
  ) {}

  /**
   * Runs the conversion pipeline for a queued job: claim it (processing
   * lease), charge its credits (atomic, at most once per job), trace, store
   * the result in R2, record the Conversion, mark the job completed.
   *
   * Safe under queue redelivery and crashes:
   *  - completed job  -> returns the existing conversion (no re-trace, no second charge)
   *  - failed job     -> terminal, returns [] (the user retries with a new job)
   *  - processing job -> JobLeaseHeldError while another delivery's lease is
   *    live; after it expires (that worker died) the job is taken over and
   *    re-run — the charge, R2 key and Conversion row are all idempotent
   *  - concurrent claim -> the loser gets ConflictError
   * Terminal failures are handled by failJob, which refunds the charge. See
   * queueConsumer.ts for how each outcome maps to ack/retry.
   *
   * ProviderSelector routes every image to the Vectorla engine; if it (or a
   * not-yet-implemented provider) throws, tracing falls back to ImageTracer.
   * A job whose preset is PROFESSIONAL_TRACE_JOB_PRESET runs the
   * Professional profile (pipeline/ProfessionalTracePipeline.ts).
   */
  async processJob(jobId: string, now: number = Date.now()): Promise<Conversion[]> {
    const job = await this.jobs.getJob(jobId)

    if (job.status === 'completed') {
      const existing = await this.conversions.findByJobId(jobId)
      return existing ? [existing] : []
    }
    // Terminal: a failed job is never reprocessed by a stale delivery (the
    // user retries by creating a new job). Its credits were already refunded.
    if (job.status === 'failed') return []

    const upload = await this.uploads.findById(job.uploadId)
    if (!upload) {
      throw new NotFoundError(`No upload found with id "${job.uploadId}"`)
    }

    // Throws JobLeaseHeldError (another live delivery owns it) or
    // ConflictError (a concurrent delivery claimed it first).
    const claimed = await this.jobs.claimForProcessing(job, now)

    // TODO(backend): formatCount/printReady are hardcoded until Job carries
    // the caller's requested formats/print-ready flag — see calculateRequiredCredits.
    // Professional Trace bills PROFESSIONAL_TRACE_CREDIT_MULTIPLIER times the base cost.
    const isProfessionalTrace = claimed.preset === PROFESSIONAL_TRACE_JOB_PRESET
    const requiredCredits = calculateRequiredCredits(1, false) * (isProfessionalTrace ? PROFESSIONAL_TRACE_CREDIT_MULTIPLIER : 1)
    // Charged up front, atomically and at most once per job: concurrent jobs
    // can't overdraw the balance, and a retried job is never charged twice.
    // A job that later fails terminally is refunded (failJob).
    await this.credits.chargeJob(claimed.userId, claimed.id, requiredCredits, `Conversion for job "${claimed.id}"`)

    const fileStream = await this.storage.getFile(upload.storageKey)
    const fileBytes = await new Response(fileStream).arrayBuffer()

    const result = isProfessionalTrace
      ? await this.traceProfessional(claimed.id, upload, fileBytes)
      : await this.traceQuick(claimed.id, claimed.preset, upload, fileBytes)
    // Deterministic key: a retry after a crash simply overwrites the object.
    const storageKey = `conversions/${claimed.userId}/${claimed.id}/output.${result.format}`
    await this.storage.storeFile(storageKey, result.data)

    let created = await this.conversions.findByJobId(claimed.id)
    if (!created) {
      const conversion: Conversion = {
        id: crypto.randomUUID(),
        jobId: claimed.id,
        userId: claimed.userId,
        format: result.format,
        storageKey,
        fileSizeBytes: result.data.byteLength,
        downloadUrl: null,
        createdAt: new Date().toISOString(),
      }
      created = await this.conversions.create(conversion)
    }

    await this.jobs.markCompleted(claimed.id)
    return [created]
  }

  /**
   * Terminal failure: marks the job failed and refunds its charge (exactly
   * once — a no-op if it was never charged or already refunded).
   */
  async failJob(jobId: string, reason: string): Promise<void> {
    const job = await this.jobs.getJob(jobId)
    if (job.status === 'completed') return
    if (job.status !== 'failed') await this.jobs.markFailed(jobId, reason)
    await this.credits.refundJobDebit(job.userId, jobId, `Refund: job failed (${reason.slice(0, 120)})`)
  }

  /** Professional Trace: the engine's Professional profile, ImageTracer fallback on failure. */
  private async traceProfessional(jobId: string, upload: Upload, fileBytes: ArrayBuffer): Promise<VectorizationResult> {
    const imageData = await decodeImage(upload.mimeType, fileBytes, this.decoderWasm)
    try {
      const pipelineResult = runProfessionalTrace(imageData, sourceFormatFromMime(upload.mimeType))
      console.log(
        `[professional-trace] job "${jobId}": provider=${pipelineResult.provider} profile=${pipelineResult.tracePreset} ` +
          `colors=${pipelineResult.engine.paletteSize} paths=${pipelineResult.engine.pathCount} ` +
          `totalTimeMs=${pipelineResult.totalTimeMs.toFixed(1)} stages=[${pipelineResult.stageTimings
            .map((t) => `${t.name}:${t.durationMs.toFixed(1)}ms`)
            .join(', ')}]`,
      )
      return { data: new TextEncoder().encode(pipelineResult.svg).buffer as ArrayBuffer, format: 'svg' }
    } catch (error) {
      console.error(
        `[professional-trace] engine failed for job "${jobId}" — falling back to the ImageTracer engine:`,
        error instanceof Error ? error.message : error,
      )
      return createProviderByName('placeholder', this.decoderWasm).vectorize(upload, fileBytes, null)
    }
  }

  /**
   * Quick Trace: the provider ImageAnalysisService recommends (the Vectorla
   * engine). The engine picks its own palette and settings, so only an
   * explicit caller preset adjusts it; the auto-recommended legacy preset
   * is only used by the ImageTracer fallback.
   */
  private async traceQuick(jobId: string, jobPreset: string | null, upload: Upload, fileBytes: ArrayBuffer): Promise<VectorizationResult> {
    const analysis = await this.imageAnalysis.analyze(upload, fileBytes)
    const legacyPreset = jobPreset ?? analysis.recommendedTracePreset
    try {
      const provider = createProviderByName(analysis.recommendedProvider, this.decoderWasm)
      return await provider.vectorize(upload, fileBytes, analysis.recommendedProvider === 'vectorla' ? jobPreset : legacyPreset)
    } catch (error) {
      // Unimplemented providers (vision/openai) and any unexpected failure
      // of the Vectorla engine fall back to the ImageTracer engine, so a
      // tracing bug degrades output quality instead of failing the job.
      if (!(error instanceof NotImplementedError) && analysis.recommendedProvider !== 'vectorla') throw error
      console.error(
        `Provider "${analysis.recommendedProvider}" failed for job "${jobId}" — falling back to the ImageTracer engine:`,
        error instanceof Error ? error.message : error,
      )
      return createProviderByName('placeholder', this.decoderWasm).vectorize(upload, fileBytes, legacyPreset)
    }
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
  const decoderWasm: RasterDecoderWasm = { png: env.PNG_DECODER_WASM, jpeg: env.JPEG_DECODER_WASM, webp: env.WEBP_DECODER_WASM }
  const imageAnalysis = createImageAnalysisService(decoderWasm)
  const credits = createCreditsService(env)
  return new ConversionService(jobs, uploads, storage, conversions, imageAnalysis, decoderWasm, credits)
}

/**
 * Errors that retrying cannot fix — the queue consumer fails these jobs
 * immediately (and refunds) instead of burning retries on them.
 */
export function isPermanentJobError(error: unknown): boolean {
  return (
    error instanceof InsufficientCreditsError ||
    error instanceof PayloadTooLargeError ||
    error instanceof UnsupportedMediaTypeError ||
    error instanceof ValidationError ||
    error instanceof NotFoundError ||
    (error instanceof Error && error.message.startsWith('Failed to decode'))
  )
}
