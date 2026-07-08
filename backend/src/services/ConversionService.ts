import type { Conversion } from '../types'
import type { Env } from '../env'
import { JobService, createJobService } from './JobService'
import { StorageService } from './StorageService'
import { createR2Client } from '../integrations/r2'
import { createUploadsRepository } from '../repositories/createUploadsRepository'
import { createConversionsRepository } from '../repositories/createConversionsRepository'
import type { UploadsRepository } from '../repositories/UploadsRepository'
import type { ConversionsRepository } from '../repositories/ConversionsRepository'
import { NotFoundError } from '../errors'

// TODO(backend): this is where the real AI vectorization call goes once it
// exists — today processJob only produces a placeholder SVG, so the pipeline
// (queue -> processing -> storage -> metadata -> completed) can be exercised
// end-to-end without a real tracing engine.
function buildPlaceholderSvg(): ArrayBuffer {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <rect width="512" height="512" fill="#f4f4f5"/>
  <text x="50%" y="50%" text-anchor="middle" dominant-baseline="middle" font-family="sans-serif" font-size="28" fill="#18181b">Vectorla Preview</text>
</svg>`
  return new TextEncoder().encode(svg).buffer as ArrayBuffer
}

export class ConversionService {
  constructor(
    private readonly jobs: JobService,
    private readonly uploads: UploadsRepository,
    private readonly storage: StorageService,
    private readonly conversions: ConversionsRepository,
  ) {}

  /**
   * Runs the (currently placeholder) conversion pipeline for a queued job:
   * load job + upload, mark processing, produce an SVG, store it in R2, save
   * the Conversion row, then mark the job completed. Called by the Worker's
   * queue() consumer (see index.ts) once per queue message.
   */
  async processJob(jobId: string): Promise<Conversion[]> {
    const job = await this.jobs.getJob(jobId)
    const upload = await this.uploads.findById(job.uploadId)
    if (!upload) {
      throw new NotFoundError(`No upload found with id "${job.uploadId}"`)
    }

    await this.jobs.markProcessing(job.id)

    const svg = buildPlaceholderSvg()
    const storageKey = `conversions/${job.userId}/${job.id}/output.svg`
    await this.storage.storeFile(storageKey, svg)

    const conversion: Conversion = {
      id: crypto.randomUUID(),
      jobId: job.id,
      userId: job.userId,
      format: 'svg',
      storageKey,
      fileSizeBytes: svg.byteLength,
      downloadUrl: null,
      createdAt: new Date().toISOString(),
    }
    const created = await this.conversions.create(conversion)

    await this.jobs.markCompleted(job.id)

    return [created]
  }

  async getConversion(conversionId: string): Promise<Conversion> {
    const conversion = await this.conversions.findById(conversionId)
    if (!conversion) throw new NotFoundError(`No conversion found with id "${conversionId}"`)
    return conversion
  }
}

export function createConversionService(env: Env): ConversionService {
  const jobs = createJobService(env)
  const uploads = createUploadsRepository(env)
  const r2 = createR2Client(env.UPLOADS_BUCKET)
  const storage = new StorageService(r2)
  const conversions = createConversionsRepository(env)
  return new ConversionService(jobs, uploads, storage, conversions)
}
