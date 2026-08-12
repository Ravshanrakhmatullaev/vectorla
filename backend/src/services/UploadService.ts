import type { Upload, UserPlan } from '../types'
import type { Env } from '../env'
import { isLocalDevelopment } from '../env'
import { StorageService } from './StorageService'
import { createR2Client } from '../integrations/r2'
import { createUploadsRepository } from '../repositories/createUploadsRepository'
import type { UploadsRepository } from '../repositories/UploadsRepository'
import { ConflictError } from '../errors'
import {
  validateFileName,
  validateMimeType,
  validateExtensionMatchesMimeType,
  validateNotEmpty,
  validateFileSize,
  validateFileSignature,
  getCanonicalExtension,
} from './validateUpload'

export interface CreateUploadInput {
  // Derived from the authenticated session by routes/uploads.ts (see
  // middleware/requireAuth.ts) — this service itself doesn't verify identity.
  userId: string
  // Resolved from the authenticated user's server-side profile by the route.
  plan: UserPlan
  file: ArrayBuffer
  originalFileName: string
  mimeType: string
}

export class UploadService {
  constructor(
    private readonly storage: StorageService,
    private readonly repository: UploadsRepository,
    // Local development only (see env.ts's isLocalDevelopment) — never true
    // in staging/production. Repeatedly re-uploading the same sample file
    // while testing locally must not require picking a new filename every
    // time; the (userId, originalFileName) uniqueness guarantee itself is
    // untouched (still real, still enforced atomically by repository.create()
    // below) — this only disambiguates the incoming name first so that
    // guarantee is never actually hit locally.
    private readonly allowDuplicateFilenames: boolean = false,
  ) {}

  async createUpload(input: CreateUploadInput): Promise<Upload> {
    validateFileName(input.originalFileName)
    validateMimeType(input.mimeType)
    validateExtensionMatchesMimeType(input.originalFileName, input.mimeType)
    validateNotEmpty(input.file.byteLength)
    validateFileSize(input.file.byteLength, input.plan)
    validateFileSignature(input.file, input.mimeType)

    // Fast path: avoids a wasted R2 write in the common (non-racing) case.
    // The real guarantee is repository.create()'s atomic uniqueness check
    // below (schema.sql's unique(user_id, original_file_name) index) — this
    // pre-check alone has a TOCTOU window under concurrent identical requests.
    const existing = await this.repository.findByUserAndFilename(input.userId, input.originalFileName)
    if (existing && !this.allowDuplicateFilenames) {
      throw new ConflictError(`A file named "${input.originalFileName}" has already been uploaded`)
    }

    const id = crypto.randomUUID()
    // Deliberately excludes the caller-supplied originalFileName: keys must
    // be fully random with no user-controlled path segments (see Phase 17
    // security audit). The extension comes from the already-validated
    // mimeType, never from the raw filename.
    const storageKey = `uploads/${input.userId}/${id}${getCanonicalExtension(input.mimeType)}`

    await this.storage.storeFile(storageKey, input.file)

    // Only reached when allowDuplicateFilenames is true and a same-named
    // upload already exists — disambiguate so repository.create()'s real
    // uniqueness guarantee (still fully active) is never hit locally.
    const originalFileName = existing ? `${input.originalFileName} (${id.slice(0, 8)})` : input.originalFileName

    const upload: Upload = {
      id,
      userId: input.userId,
      originalFileName,
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
  const storage = new StorageService(r2, env.DOWNLOAD_URL_SECRET)
  const repository = createUploadsRepository(env)
  return new UploadService(storage, repository, isLocalDevelopment(env))
}
