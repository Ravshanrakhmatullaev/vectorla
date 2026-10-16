import type { Upload, UserPlan } from '../types'
import type { Env } from '../env'
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
import { assertDimensionsWithinLimits } from '../providers/imageDimensions'

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

/** Numbered copies ("logo (2).png" … "logo (10).png") tried before a short random suffix is used. */
const MAX_NUMBERED_COPIES = 10
/** How many times a lost race for a stored name is retried with the next free name. */
const MAX_NAME_RETRIES = 5

/** "logo.png" → ["logo", ".png"]; a name without an extension keeps an empty one. */
function splitFileName(fileName: string): [string, string] {
  const dot = fileName.lastIndexOf('.')
  return dot <= 0 ? [fileName, ''] : [fileName.slice(0, dot), fileName.slice(dot)]
}

export class UploadService {
  constructor(
    private readonly storage: StorageService,
    private readonly repository: UploadsRepository,
  ) {}

  /**
   * The name an upload is stored under. A user may upload the same file name
   * again (re-tracing a logo in another mode, an edited file saved over the
   * old name, a retry): the first free name among "name", "name (2)" …
   * "name (10)" is used, then "name (<id prefix>)". The database's
   * (user_id, original_file_name) uniqueness stays in force underneath; names
   * already known to be taken (`taken`) are skipped without another lookup.
   */
  private async chooseStoredName(userId: string, fileName: string, id: string, taken: Set<string>): Promise<string> {
    const [stem, extension] = splitFileName(fileName)
    for (let copy = 1; copy <= MAX_NUMBERED_COPIES; copy++) {
      const candidate = copy === 1 ? fileName : `${stem} (${copy})${extension}`
      if (taken.has(candidate)) continue
      if (!(await this.repository.findByUserAndFilename(userId, candidate))) return candidate
      taken.add(candidate)
    }
    return `${stem} (${id.slice(0, 8)})${extension}`
  }

  async createUpload(input: CreateUploadInput): Promise<Upload> {
    validateFileName(input.originalFileName)
    validateMimeType(input.mimeType)
    validateExtensionMatchesMimeType(input.originalFileName, input.mimeType)
    validateNotEmpty(input.file.byteLength)
    validateFileSize(input.file.byteLength, input.plan)
    validateFileSignature(input.file, input.mimeType)
    assertDimensionsWithinLimits(input.file, input.mimeType)

    const id = crypto.randomUUID()
    // Deliberately excludes the caller-supplied originalFileName: keys must
    // be fully random with no user-controlled path segments (see Phase 17
    // security audit). The extension comes from the already-validated
    // mimeType, never from the raw filename.
    const storageKey = `uploads/${input.userId}/${id}${getCanonicalExtension(input.mimeType)}`

    // Chosen before the R2 write, so no lookups happen after the file is stored
    // in the common case.
    const taken = new Set<string>()
    let originalFileName = await this.chooseStoredName(input.userId, input.originalFileName, id, taken)

    await this.storage.storeFile(storageKey, input.file)

    // The file is stored before its row; if the row can't be written the
    // file is deleted right away. Should that delete fail too, the
    // scheduled OrphanSweeper removes it after its grace period.
    for (let attempt = 0; ; attempt++) {
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
      try {
        return await this.repository.create(upload)
      } catch (error) {
        // Another request took the same name between the lookup and the insert
        // (the repository's uniqueness check is the atomic guarantee): store
        // under the next free name instead of failing the user's upload.
        if (error instanceof ConflictError && attempt < MAX_NAME_RETRIES) {
          taken.add(originalFileName)
          originalFileName = await this.chooseStoredName(input.userId, input.originalFileName, id, taken)
          continue
        }
        await this.storage.deleteFile(storageKey).catch((cleanupError: unknown) => {
          console.error(`Failed to delete ${storageKey} after its upload row failed; the orphan sweep will remove it:`, cleanupError)
        })
        throw error
      }
    }
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
  return new UploadService(storage, repository)
}
