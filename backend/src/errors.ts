/** Thrown by validation — routes map this to HTTP 400. */
export class ValidationError extends Error {}

/** Thrown when a file exceeds the caller's plan limit — routes map this to HTTP 413. */
export class PayloadTooLargeError extends Error {}

/** Thrown for an unsupported/mismatched MIME type or extension — routes map this to HTTP 415. */
export class UnsupportedMediaTypeError extends Error {}
