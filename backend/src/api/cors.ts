import type { Env } from '../env'

// Production origins this API serves — see PROJECT_CONTEXT.md for the
// vectorla.app domain. Update this list (not the whole CORS mechanism) as
// real frontend origins are added.
const ALLOWED_ORIGINS = new Set(['https://vectorla.app', 'https://www.vectorla.app'])

// Local frontend dev servers (Vite defaults to 5173) — only honored outside
// production, so this can never widen CORS on a live deploy.
const DEV_ORIGIN_PATTERN = /^http:\/\/localhost:\d+$/

const ALLOWED_METHODS = 'GET, POST, OPTIONS'
const ALLOWED_HEADERS = 'Content-Type, Authorization, X-Test-User-Id'

function resolveAllowedOrigin(request: Request, env: Env): string | null {
  const origin = request.headers.get('Origin')
  if (!origin) return null
  if (ALLOWED_ORIGINS.has(origin)) return origin
  if (env.ENVIRONMENT !== 'production' && DEV_ORIGIN_PATTERN.test(origin)) return origin
  return null
}

/** Handles a CORS preflight request directly — returns null for anything else (let normal routing continue). */
export function handlePreflight(request: Request, env: Env): Response | null {
  if (request.method !== 'OPTIONS') return null

  const allowedOrigin = resolveAllowedOrigin(request, env)
  const headers = new Headers({ Vary: 'Origin' })
  if (allowedOrigin) {
    headers.set('Access-Control-Allow-Origin', allowedOrigin)
    headers.set('Access-Control-Allow-Methods', ALLOWED_METHODS)
    headers.set('Access-Control-Allow-Headers', ALLOWED_HEADERS)
    headers.set('Access-Control-Max-Age', '86400')
  }
  return new Response(null, { status: 204, headers })
}

/** Adds CORS headers to an already-built response, for a recognized Origin — never mutates the original Response object. */
export function applyCors(response: Response, request: Request, env: Env): Response {
  const allowedOrigin = resolveAllowedOrigin(request, env)
  if (!allowedOrigin) return response

  const headers = new Headers(response.headers)
  headers.set('Access-Control-Allow-Origin', allowedOrigin)
  headers.set('Vary', 'Origin')
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers })
}
