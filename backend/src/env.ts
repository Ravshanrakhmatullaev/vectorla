import type { R2Bucket, Queue } from '@cloudflare/workers-types'
import type { ConversionQueueMessage } from './integrations/queue'
import type { VectorizationProviderName } from './providers/VectorizationProvider'

/** Bindings + secrets declared in wrangler.toml — see that file for how each is provisioned. */
export interface Env {
  UPLOADS_BUCKET: R2Bucket
  CONVERSION_QUEUE: Queue<ConversionQueueMessage>
  SUPABASE_URL: string
  SUPABASE_SERVICE_ROLE_KEY: string
  /** HMAC key for StorageService's self-signed download URLs (see StorageService.getSignedDownloadUrl). */
  DOWNLOAD_URL_SECRET: string
  /** Selects the VectorizationProvider ConversionService uses — see providers/ProviderFactory.ts. */
  VECTORIZATION_PROVIDER: VectorizationProviderName
  /**
   * jSquash's WASM raster decoders (Phase 19) — bound via wrangler.toml's
   * [[wasm_modules]], which compiles each .wasm file to a WebAssembly.Module
   * at build/bundle time (no runtime fetch, no filesystem access needed).
   * See providers/PlaceholderProvider.ts for how these get used.
   */
  PNG_DECODER_WASM: WebAssembly.Module
  JPEG_DECODER_WASM: WebAssembly.Module
  WEBP_DECODER_WASM: WebAssembly.Module
  ENVIRONMENT: 'development' | 'staging' | 'production'
  /**
   * Optional comma-separated list of extra exact HTTPS origins allowed by
   * CORS (e.g. the staging Cloudflare Pages URL). A plain var, set per
   * environment in wrangler.toml — see api/cors.ts.
   */
  CORS_EXTRA_ORIGINS?: string
  /**
   * Local memory measurement only: '1' (with ENVIRONMENT=development) makes
   * the tracing engine pause at its memory checkpoints when a debugger is
   * attached (see engine/memoryCheckpoint.ts and BENCHMARKS.md "Memory").
   * Never set in staging or production.
   */
  MEMORY_CHECKPOINTS?: string
  /**
   * Optional Cloudflare Workers Rate Limiting binding (wrangler.toml
   * [[ratelimits]], see DEPLOYMENT.md): per-client-IP request limit checked
   * before routing. Absent locally and until it is configured; the per-user
   * limits in services/UsageLimitsService.ts apply either way.
   */
  API_RATE_LIMITER?: RateLimitBinding
}

/** The Workers Rate Limiting binding's API (a subset of @cloudflare/workers-types' RateLimit). */
export interface RateLimitBinding {
  limit(options: { key: string }): Promise<{ success: boolean }>
}

/**
 * True only for local `wrangler dev` (never staging, never production) — the
 * single switch gating every local-development convenience (auto credit
 * top-up, relaxed duplicate-filename checks — see CreditsService.ts and
 * UploadService.ts). Staging intentionally behaves like production so it
 * keeps testing real constraints.
 */
export function isLocalDevelopment(env: Env): boolean {
  return env.ENVIRONMENT === 'development'
}

/**
 * Second guard for the development-only identity and credit shortcuts
 * (requireAuth's X-Test-User-Id, the dev credit-grant route): besides
 * ENVIRONMENT === 'development', the request itself must address this
 * machine. A deployed Worker misconfigured with ENVIRONMENT=development
 * still serves a public hostname, so the shortcuts stay closed there.
 */
export function isLocalRequest(request: Request): boolean {
  const host = new URL(request.url).hostname
  return host === 'localhost' || host === '127.0.0.1' || host === '[::1]'
}

const REQUIRED_BACKEND_SECRETS = [
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'DOWNLOAD_URL_SECRET',
] as const satisfies readonly (keyof Env)[]

/** Staging and production fail closed instead of using local-only fallbacks. */
export function assertRequiredBackendSecrets(env: Env): void {
  if (isLocalDevelopment(env)) return

  const missing = REQUIRED_BACKEND_SECRETS.filter((key) => {
    const value = env[key]
    return typeof value !== 'string' || value.trim().length === 0
  })
  if (missing.length > 0) {
    throw new Error(`Missing required backend secrets for ${env.ENVIRONMENT}: ${missing.join(', ')}`)
  }
}

/** Returns true only when an explicit development environment may use local persistence. */
export function shouldUseInMemoryRepositories(env: Env): boolean {
  const hasSupabase = Boolean(env.SUPABASE_URL?.trim() && env.SUPABASE_SERVICE_ROLE_KEY?.trim())
  if (hasSupabase) return false
  if (isLocalDevelopment(env)) return true
  throw new Error(`Supabase credentials are required in ${env.ENVIRONMENT}`)
}
