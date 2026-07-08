import type { Upload, UserPlan } from '../types'
import type { Env } from '../env'
import { StorageService } from './StorageService'
import { createR2Client } from '../integrations/r2'
import { createUploadsRepository } from '../repositories/createUploadsRepository'
import type { UploadsRepository } from '../repositories/UploadsRepository'
import { ValidationError } from '../errors'
import {
  validateFileName,
  validateMimeType,
  validateExtensionMatchesMimeType,
  validateNotEmpty,
  validateFileSize,
} from './validateUpload'

export interface CreateUploadInput {
  userId: string
  // TODO(backend): derive from the authenticated session once auth exists —
  // callers currently declare their own plan, which is not secure and is only
  // acceptable because there's no real auth/billing yet to spoof value from.
  plan: UserPlan
  file: ArrayBuffer
  originalFileName: string
  mimeType: string
}

export class UploadService {
  constructor(
    private readonly storage: StorageService,
    private readonly repository: UploadsRepository,
  ) {}

  async createUpload(input: CreateUploadInput): Promise<Upload> {
    validateFileName(input.originalFileName)
    validateMimeType(input.mimeType)
    validateExtensionMatchesMimeType(input.originalFileName, input.mimeType)
    validateNotEmpty(input.file.byteLength)
    validateFileSize(input.file.byteLength, input.plan)

    const existing = await this.repository.findByUserAndFilename(input.userId, input.originalFileName)
    if (existing) {
      throw new ValidationError(`A file named "${input.originalFileName}" has already been uploaded`)
    }

    const id = crypto.randomUUID()
    const storageKey = `uploads/${input.userId}/${id}/${input.originalFileName}`

    await this.storage.storeFile(storageKey, input.file)

    const upload: Upload = {
      id,
      userId: input.userId,
      originalFileName: input.originalFileName,
      mimeType: input.mimeType,
      sizeBytes: input.file.byteLength,
      storageKey,
      status: 'stored',
      createdAt: new Date().toISOString(),
    }

    // NOTE: no rollback if this write fails after storage.storeFile() above
    // succeeds — that would orphan the R2 object. Acceptable for a first
    // implementation; a real system would need a cleanup job or two-phase
    // commit. See backend/README.md.
    return this.repository.create(upload)
  }

  async getUpload(_uploadId: string): Promise<Upload> {
    throw new Error('Not implemented')
  }

  async deleteUpload(_uploadId: string): Promise<void> {
    throw new Error('Not implemented')
  }
}

export function createUploadService(env: Env): UploadService {
  const r2 = createR2Client(env.UPLOADS_BUCKET)
  const storage = new StorageService(r2)
  const repository = createUploadsRepository(env)
  return new UploadService(storage, repository)
}
