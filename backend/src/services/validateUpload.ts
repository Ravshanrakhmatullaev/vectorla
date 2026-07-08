import { ValidationError, PayloadTooLargeError, UnsupportedMediaTypeError } from '../errors'
import { ALLOWED_UPLOAD_MIME_TYPES } from '../config'
import { PLAN_LIMITS } from '../config'
import type { UserPlan } from '../types'

const MIME_TO_EXTENSIONS: Record<string, string[]> = {
  'image/png': ['.png'],
  'image/jpeg': ['.jpg', '.jpeg'],
  'image/webp': ['.webp'],
}

// Magic-byte signatures for the allowed upload types — the declared
// mimeType/extension are just client-asserted labels; this checks the
// actual bytes so a mislabeled/renamed file (e.g. a script saved as
// "photo.png") can't pass validation on labels alone.
const FILE_SIGNATURES: Record<string, (bytes: Uint8Array) => boolean> = {
  'image/png': (bytes) =>
    bytes.length >= 8 &&
    [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((byte, index) => bytes[index] === byte),
  'image/jpeg': (bytes) => bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff,
  'image/webp': (bytes) =>
    bytes.length >= 12 &&
    [0x52, 0x49, 0x46, 0x46].every((byte, index) => bytes[index] === byte) &&
    [0x57, 0x45, 0x42, 0x50].every((byte, index) => bytes[8 + index] === byte),
}

function getExtension(fileName: string): string {
  const dotIndex = fileName.lastIndexOf('.')
  return dotIndex === -1 ? '' : fileName.slice(dotIndex).toLowerCase()
}

/** The canonical extension for a validated mimeType — used to build storage keys without trusting the caller's filename. */
export function getCanonicalExtension(mimeType: string): string {
  const extension = MIME_TO_EXTENSIONS[mimeType]?.[0]
  if (!extension) throw new UnsupportedMediaTypeError(`No canonical extension for mime type "${mimeType}"`)
  return extension
}

export function validateFileName(fileName: string): void {
  if (!fileName || fileName.trim().length === 0) {
    throw new ValidationError('Missing file name')
  }
}

export function validateMimeType(mimeType: string): void {
  const allowed: readonly string[] = ALLOWED_UPLOAD_MIME_TYPES
  if (!allowed.includes(mimeType)) {
    throw new UnsupportedMediaTypeError(
      `Unsupported file type "${mimeType}". Allowed types: ${ALLOWED_UPLOAD_MIME_TYPES.join(', ')}`,
    )
  }
}

export function validateExtensionMatchesMimeType(fileName: string, mimeType: string): void {
  const extension = getExtension(fileName)
  const allowedExtensions = MIME_TO_EXTENSIONS[mimeType]
  if (!allowedExtensions || !allowedExtensions.includes(extension)) {
    throw new UnsupportedMediaTypeError(
      `File extension "${extension}" does not match declared type "${mimeType}"`,
    )
  }
}

export function validateNotEmpty(sizeBytes: number): void {
  if (sizeBytes === 0) {
    throw new ValidationError('Uploaded file is empty')
  }
}

export function validateFileSize(sizeBytes: number, plan: UserPlan): void {
  const maxSizeBytes = PLAN_LIMITS[plan].maxFileSizeBytes
  if (sizeBytes > maxSizeBytes) {
    throw new PayloadTooLargeError(
      `File size (${sizeBytes} bytes) exceeds the ${plan} plan's limit of ${maxSizeBytes} bytes`,
    )
  }
}

/** Checks the file's actual magic bytes against its declared mimeType — see FILE_SIGNATURES above. */
export function validateFileSignature(file: ArrayBuffer, mimeType: string): void {
  const matchesSignature = FILE_SIGNATURES[mimeType]
  // Every entry in ALLOWED_UPLOAD_MIME_TYPES has a signature above, so this
  // is unreachable in practice — fails closed (rejects) rather than silently
  // passing an unrecognized type through, in case that ever drifts out of sync.
  if (!matchesSignature || !matchesSignature(new Uint8Array(file.slice(0, 12)))) {
    throw new UnsupportedMediaTypeError(`File content does not match declared type "${mimeType}"`)
  }
}
