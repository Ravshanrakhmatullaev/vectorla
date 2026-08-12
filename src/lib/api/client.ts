// Thin fetch wrapper for the Vectorla backend (see backend/API.md). Kept
// deliberately small — one shared envelope parser, no request library.

import { getAccessToken, isSupabaseConfigured } from '@/lib/supabase'

export type ApiErrorCode =
  | 'VALIDATION_ERROR'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'INSUFFICIENT_CREDITS'
  | 'INTERNAL_ERROR'
  | 'NETWORK_ERROR'

interface ApiEnvelope<T> {
  success: boolean
  data?: T
  error?: { code: ApiErrorCode; message: string }
  requestId?: string
}

export class ApiError extends Error {
  readonly code: ApiErrorCode
  readonly status: number
  readonly requestId: string | null

  constructor(message: string, code: ApiErrorCode, status: number, requestId: string | null) {
    super(message)
    this.name = 'ApiError'
    this.code = code
    this.status = status
    this.requestId = requestId
  }
}

const DEV_USER_ID_KEY = 'vectorla-dev-user-id'

/** Local fallback used only when Vite dev runs without configured Supabase Auth. */
function getDevTestUserId(): string {
  const existing = window.localStorage.getItem(DEV_USER_ID_KEY)
  if (existing) return existing
  const id = `dev-${crypto.randomUUID()}`
  window.localStorage.setItem(DEV_USER_ID_KEY, id)
  return id
}

export function getApiBaseUrl(): string {
  return import.meta.env.VITE_API_BASE_URL?.trim() ?? ''
}

/** Preview Mode falls back to this when false — see WorkspacePreview.tsx. */
export function isBackendConfigured(): boolean {
  return getApiBaseUrl().length > 0
}

async function buildHeaders(extra?: HeadersInit): Promise<Headers> {
  const headers = new Headers(extra)
  const accessToken = await getAccessToken()
  if (accessToken) {
    headers.set('Authorization', `Bearer ${accessToken}`)
  } else if (import.meta.env.DEV && !isSupabaseConfigured) {
    headers.set('X-Test-User-Id', getDevTestUserId())
  }
  return headers
}

function requireBaseUrl(): string {
  const baseUrl = getApiBaseUrl()
  if (!baseUrl) {
    throw new ApiError('VITE_API_BASE_URL is not configured', 'NETWORK_ERROR', 0, null)
  }
  return baseUrl
}

// Local development only (import.meta.env.DEV, Vite's own dev/build switch —
// false in every production build, so this never runs there). `wrangler dev`
// briefly refuses connections while it rebuilds after a source-file save; a
// request that happens to land in that window would otherwise surface as a
// misleading "Could not reach the API server" even though the backend is
// actually running. A couple of short retries ride out that window instead
// of failing the whole request on a one-off blip.
const DEV_FETCH_RETRY_ATTEMPTS = 2
const DEV_FETCH_RETRY_DELAY_MS = 300

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function devFetch(url: string, init: RequestInit): Promise<Response> {
  if (!import.meta.env.DEV) return fetch(url, init)
  let lastError: unknown
  for (let attempt = 0; attempt <= DEV_FETCH_RETRY_ATTEMPTS; attempt++) {
    try {
      return await fetch(url, init)
    } catch (error) {
      lastError = error
      if (attempt < DEV_FETCH_RETRY_ATTEMPTS) await delay(DEV_FETCH_RETRY_DELAY_MS)
    }
  }
  throw lastError
}

function describeUnreachable(baseUrl: string): string {
  return import.meta.env.DEV
    ? `Could not reach the API server at ${baseUrl}. Is the backend dev server running? (cd backend && npm run dev)`
    : 'Could not reach the API server'
}

async function parseEnvelope<T>(response: Response): Promise<T> {
  let body: ApiEnvelope<T> | null = null
  try {
    body = (await response.json()) as ApiEnvelope<T>
  } catch {
    // fall through — non-JSON error bodies (e.g. a proxy 502 page) are handled below
  }

  // Not a plain response.ok check: the backend deliberately uses non-2xx
  // statuses (202 queued/processing, 410 failed) inside a success envelope
  // for GET /jobs/:id/conversion — see backend/API.md. `success` is the only
  // reliable signal; a truly broken response (e.g. a proxy's HTML error
  // page) fails `!body` instead, since it won't parse as JSON at all.
  if (!body || body.success === false) {
    throw new ApiError(
      body?.error?.message ?? `Request failed with status ${response.status}`,
      body?.error?.code ?? 'INTERNAL_ERROR',
      response.status,
      body?.requestId ?? null,
    )
  }

  return body.data as T
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const baseUrl = requireBaseUrl()
  let response: Response
  try {
    // no-store: GET /jobs/:id/conversion is polled against the exact same
    // URL every second (see useUploadFlow) — the backend sets no explicit
    // Cache-Control on its JSON responses, and this was observed to get
    // served stale from the browser's HTTP cache under default caching,
    // which would freeze the UI on an old status forever.
    response = await devFetch(`${baseUrl}${path}`, { ...init, headers: await buildHeaders(init?.headers), cache: 'no-store' })
  } catch {
    throw new ApiError(describeUnreachable(baseUrl), 'NETWORK_ERROR', 0, null)
  }
  return parseEnvelope<T>(response)
}

export function apiGet<T>(path: string): Promise<T> {
  return request<T>(path)
}

export function apiPostForm<T>(path: string, form: FormData): Promise<T> {
  return request<T>(path, { method: 'POST', body: form })
}

export function apiPostJson<T>(path: string, body: unknown): Promise<T> {
  const headers = new Headers({ 'Content-Type': 'application/json' })
  return request<T>(path, { method: 'POST', headers, body: JSON.stringify(body) })
}

/**
 * Raw (non-JSON-envelope) fetch, for the one endpoint that streams bytes on
 * success — GET /download (see backend/API.md). Still attaches the same auth
 * headers as every other call; a plain `<a href>`/`window.open` navigation
 * can't do that, since custom headers aren't available to browser navigation.
 */
export async function apiFetchRaw(path: string, init?: RequestInit): Promise<Response> {
  const baseUrl = requireBaseUrl()
  try {
    return await devFetch(`${baseUrl}${path}`, { ...init, headers: await buildHeaders(init?.headers) })
  } catch {
    throw new ApiError(describeUnreachable(baseUrl), 'NETWORK_ERROR', 0, null)
  }
}
