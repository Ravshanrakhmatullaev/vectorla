import {
  ValidationError,
  PayloadTooLargeError,
  UnsupportedMediaTypeError,
  UnauthorizedError,
  ForbiddenError,
  NotFoundError,
  ConflictError,
  InsufficientCreditsError,
  NotImplementedError,
} from '../errors'

/**
 * Standardized error codes (Phase 21) — the fixed vocabulary every endpoint
 * uses in ErrorResponse.error.code. Deliberately smaller than the set of
 * HTTP statuses in use: code identifies *what kind* of error this is for
 * programmatic handling, status stays the transport-level detail (e.g. both
 * 413 and 415 map to VALIDATION_ERROR, since callers branch on `code`, not
 * on which validation rule specifically failed).
 */
export type ApiErrorCode =
  | 'VALIDATION_ERROR'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'INSUFFICIENT_CREDITS'
  | 'INTERNAL_ERROR'

export interface SuccessResponse<T> {
  success: true
  data: T
  requestId: string
}

export interface ErrorResponse {
  success: false
  error: {
    code: ApiErrorCode
    message: string
  }
  requestId: string
}

export interface PaginationMeta {
  total: number
  limit: number
  offset: number
  hasMore: boolean
}

export interface PaginatedResponse<T> {
  success: true
  data: T[]
  pagination: PaginationMeta
  requestId: string
}

function jsonHeaders(): HeadersInit {
  return { 'content-type': 'application/json' }
}

export function jsonSuccess<T>(data: T, status: number, requestId: string): Response {
  const body: SuccessResponse<T> = { success: true, data, requestId }
  return new Response(JSON.stringify(body), { status, headers: jsonHeaders() })
}

export function jsonPaginated<T>(data: T[], pagination: PaginationMeta, requestId: string, status = 200): Response {
  const body: PaginatedResponse<T> = { success: true, data, pagination, requestId }
  return new Response(JSON.stringify(body), { status, headers: jsonHeaders() })
}

export function jsonError(code: ApiErrorCode, message: string, status: number, requestId: string): Response {
  const body: ErrorResponse = { success: false, error: { code, message }, requestId }
  return new Response(JSON.stringify(body), { status, headers: jsonHeaders() })
}

/**
 * Adds Cache-Control: no-store to an already-built response — for the
 * polling/status endpoints a client hits repeatedly against the exact same
 * URL (GET /jobs/:id, /jobs/:id/conversion, /conversions/:id). Without this,
 * an intermediary or the browser's own HTTP cache can serve a stale status
 * (observed client-side — see src/lib/api/client.ts's matching `no-store`
 * fetch option), freezing the frontend's poll loop on an old job state.
 * Wraps both success and error responses from these routes, never mutates
 * the original Response object.
 */
export function withNoStore(response: Response): Response {
  const headers = new Headers(response.headers)
  headers.set('Cache-Control', 'no-store')
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers })
}

/**
 * The single place mapping a thrown error to (code, HTTP status, message) —
 * every route's catch block calls this instead of its own instanceof chain,
 * so the mapping only has to be right in one place.
 */
export function mapErrorToResponse(error: unknown, requestId: string): Response {
  if (error instanceof ValidationError) return jsonError('VALIDATION_ERROR', error.message, 400, requestId)
  if (error instanceof PayloadTooLargeError) return jsonError('VALIDATION_ERROR', error.message, 413, requestId)
  if (error instanceof UnsupportedMediaTypeError) return jsonError('VALIDATION_ERROR', error.message, 415, requestId)
  if (error instanceof UnauthorizedError) return jsonError('UNAUTHORIZED', error.message, 401, requestId)
  if (error instanceof ForbiddenError) return jsonError('FORBIDDEN', error.message, 403, requestId)
  if (error instanceof NotFoundError) return jsonError('NOT_FOUND', error.message, 404, requestId)
  if (error instanceof ConflictError) return jsonError('CONFLICT', error.message, 409, requestId)
  if (error instanceof InsufficientCreditsError) return jsonError('INSUFFICIENT_CREDITS', error.message, 402, requestId)
  if (error instanceof NotImplementedError) return jsonError('INTERNAL_ERROR', error.message, 501, requestId)

  console.error(`[${requestId}] Unexpected error:`, error)
  return jsonError('INTERNAL_ERROR', 'Internal Server Error', 500, requestId)
}
