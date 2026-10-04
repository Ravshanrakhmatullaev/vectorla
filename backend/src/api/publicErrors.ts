import { InsufficientCreditsError, PayloadTooLargeError, UnsupportedMediaTypeError, ValidationError } from '../errors'

/**
 * The text stored on a failed job (Job.errorMessage, returned by GET
 * /jobs/:id) and used in refund ledger entries. Users see only these fixed
 * sentences: the raw error — which can carry database errors, storage keys
 * or stack details — is logged by the caller, never stored.
 */
export const PUBLIC_JOB_ERRORS = {
  insufficientCredits: 'Not enough credits for this conversion.',
  tooLarge: 'The image is too large to convert.',
  tooComplex: 'The image is too complex to convert. Try a smaller or simpler image.',
  unreadable: 'The image could not be read. It may be damaged or in an unsupported format.',
  timedOut: 'The conversion timed out. Any credits charged were refunded.',
  failed: 'The conversion failed. Any credits charged were refunded.',
  retrying: 'The conversion hit a temporary problem and will be retried.',
} as const

export function publicJobError(error: unknown): string {
  if (error instanceof InsufficientCreditsError) return PUBLIC_JOB_ERRORS.insufficientCredits
  if (error instanceof PayloadTooLargeError) return PUBLIC_JOB_ERRORS.tooLarge
  if (error instanceof RangeError) return PUBLIC_JOB_ERRORS.tooComplex
  if (error instanceof UnsupportedMediaTypeError || error instanceof ValidationError) return PUBLIC_JOB_ERRORS.unreadable
  if (error instanceof Error && /^Failed to decode /.test(error.message)) return PUBLIC_JOB_ERRORS.unreadable
  return PUBLIC_JOB_ERRORS.failed
}
