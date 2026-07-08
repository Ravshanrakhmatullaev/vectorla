/** Thrown by validation — routes map this to HTTP 400. */
export class ValidationError extends Error {}

/** Thrown when a file exceeds the caller's plan limit — routes map this to HTTP 413. */
export class PayloadTooLargeError extends Error {}

/** Thrown for an unsupported/mismatched MIME type or extension — routes map this to HTTP 415. */
export class UnsupportedMediaTypeError extends Error {}

/** Thrown when a requested resource doesn't exist — routes map this to HTTP 404. */
export class NotFoundError extends Error {}

/** Thrown when a request has no/an invalid auth token — routes map this to HTTP 401. */
export class UnauthorizedError extends Error {}

/** Thrown when an authenticated caller tries to access another user's resource — routes map this to HTTP 403. */
export class ForbiddenError extends Error {}
