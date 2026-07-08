import { ValidationError, PayloadTooLargeError, UnsupportedMediaTypeError } from '../errors'
import { ALLOWED_UPLOAD_MIME_TYPES } from '../config'
import { PLAN_LIMITS } from '../config'
import type { UserPlan } from '../types'

const MIME_TO_EXTENSIONS: Record<string, string[]> = {
  'image/png': ['.png'],
  'image/jpeg': ['.jpg', '.jpeg'],
  'image/webp': ['.webp'],
  'image/svg+xml': ['.svg'],
}

function getExtension(fileName: string): string {
  const dotIndex = fileName.lastIndexOf('.')
  return dotIndex === -1 ? '' : fileName.slice(dotIndex).toLowerCase()
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
