import type { ExportedHandler, MessageBatch } from '@cloudflare/workers-types'
import type { Env } from './env'
import type { ConversionQueueMessage } from './integrations/queue'
import { createJobService } from './services/JobService'
import { createConversionService } from './services/ConversionService'
import { ConflictError, NotFoundError } from './errors'
import { mapErrorToResponse } from './api/response'
import { handlePreflight, applyCors } from './api/cors'
import { logRequest } from './api/logging'
import { OPENAPI_DOCUMENT } from './api/openapi'
import { handleHealthRoute } from './routes/health'
import { handleUploadsRoute } from './routes/uploads'
import { handleJobsRoute } from './routes/jobs'
import { handleConversionsRoute } from './routes/conversions'
import { handleDownloadRoute } from './routes/download'
import { handleCreditsRoute } from './routes/credits'
import { handleDevCreditsGrantRoute } from './routes/devCredits'
import { handleHistoryRoute } from './routes/history'

// Phase 21: every route lives under this version prefix — see backend/API.md.
const API_VERSION_PREFIX = '/api/v1'

async function routeRequest(url: URL, request: Request, env: Env, requestId: string): Promise<Response> {
  if (!url.pathname.startsWith(API_VERSION_PREFIX)) {
    return mapErrorToResponse(new NotFoundError(`No route for "${url.pathname}" — try "${API_VERSION_PREFIX}${url.pathname}"`), requestId)
  }
  const path = url.pathname.slice(API_VERSION_PREFIX.length) || '/'

  if (path === '/health') return handleHealthRoute(request, env, requestId)
  if (path === '/openapi.json') {
    return new Response(JSON.stringify(OPENAPI_DOCUMENT), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  if (path.startsWith('/uploads')) return handleUploadsRoute(request, env, requestId)
  if (path.startsWith('/jobs')) return handleJobsRoute(request, env, requestId)
  if (path.startsWith('/conversions')) return handleConversionsRoute(request, env, requestId)
  if (path === '/download') return handleDownloadRoute(request, env, requestId)
  if (path === '/dev/credits/grant') return handleDevCreditsGrantRoute(request, env, requestId)
  if (path.startsWith('/credits')) return handleCreditsRoute(request, env, requestId)
  if (path.startsWith('/history')) return handleHistoryRoute(request, env, requestId)
  return mapErrorToResponse(new NotFoundError(`No route for "${url.pathname}"`), requestId)
}

/**
 * Wasm-as-binding (wrangler.toml's old [wasm_modules]) only works for the
 * legacy Service Worker format — workerd requires a direct ES import for
 * modules-format Workers like this one. That import only happens here, and
 * only if env doesn't already carry these fields — e.g. index.smoke-test.ts
 * builds a fake Env with its own Node-loaded WebAssembly.Module values (see
 * testSupport/wasmTestFixtures.ts) and must never trigger it: a *static*
 * top-level `.wasm` import (tried in an earlier version of this file) broke
 * that smoke test, since Node's own ESM loader tries to parse the
 * wasm-bindgen-compiled binary itself (looking for its internal "wbg" glue
 * import) as soon as the module is loaded, regardless of whether the import
 * is ever used — a dynamic `import()`, run lazily and only on the real
 * Workers runtime, avoids that entirely.
 */
// Memoized per rawEnv identity: fetch() and queue() invocations that share
// the same underlying Env object (the normal case — bindings are stable for
// an isolate's lifetime) must resolve to the exact same merged object too,
// not a fresh `{...env}` copy each call. UploadService/JobService/etc.'s
// in-memory-fallback repositories are themselves cached in a
// WeakMap<Env, ...> (see createJobsRepository.ts) — a fresh object identity
// on every call would silently defeat that cache, making a job created by
// one request invisible to a later request/queue delivery that reads it back
// with a differently-identitied (but equivalent) env.
const envWithWasmModulesCache = new WeakMap<Env, Env>()

async function withWasmModules(env: Env): Promise<Env> {
  if (env.PNG_DECODER_WASM && env.JPEG_DECODER_WASM && env.WEBP_DECODER_WASM) return env
  const cached = envWithWasmModulesCache.get(env)
  if (cached) return cached
  // A dynamic `import()` resolves to the module's namespace object (same
  // shape as `import * as ns`) — the compiled WebAssembly.Module itself is
  // its default export, not the namespace object. Cast through `unknown`:
  // each .wasm file has its own wasm-bindgen-generated .d.ts colocated next
  // to it (describing the codec's *exported functions*, for its own JS
  // glue's internal use — see src/wasm.d.ts) which doesn't declare a
  // `default` export, so TS won't allow a direct cast to { default: Module }.
  type WasmModuleExports = { default: WebAssembly.Module }
  const [png, jpeg, webp] = await Promise.all([
    import('../node_modules/@jsquash/png/codec/pkg/squoosh_png_bg.wasm') as unknown as Promise<WasmModuleExports>,
    import('../node_modules/@jsquash/jpeg/codec/dec/mozjpeg_dec.wasm') as unknown as Promise<WasmModuleExports>,
    import('../node_modules/@jsquash/webp/codec/dec/webp_dec.wasm') as unknown as Promise<WasmModuleExports>,
  ] as const)
  const merged: Env = {
    ...env,
    PNG_DECODER_WASM: env.PNG_DECODER_WASM ?? png.default,
    JPEG_DECODER_WASM: env.JPEG_DECODER_WASM ?? jpeg.default,
    WEBP_DECODER_WASM: env.WEBP_DECODER_WASM ?? webp.default,
  }
  envWithWasmModulesCache.set(env, merged)
  return merged
}

export default {
  async fetch(request: Request, rawEnv: Env): Promise<Response> {
    const env = await withWasmModules(rawEnv)
    const requestId = crypto.randomUUID()
    const start = Date.now()
    const url = new URL(request.url)

    const preflight = handlePreflight(request, env)
    if (preflight) return preflight

    let response: Response
    try {
      response = await routeRequest(url, request, env, requestId)
    } catch (error) {
      response = mapErrorToResponse(error, requestId)
    }

    response = applyCors(response, request, env)

    const durationMs = Date.now() - start
    const headers = new Headers(response.headers)
    headers.set('X-Response-Time', `${durationMs}ms`)
    headers.set('X-Request-Id', requestId)
    const finalResponse = new Response(response.body, { status: response.status, statusText: response.statusText, headers })

    logRequest({ requestId, method: request.method, path: url.pathname, status: finalResponse.status, durationMs })

    return finalResponse
  },

  // TODO(backend): real AI vectorization goes inside ConversionService.processJob
  // — for now it produces a placeholder SVG, so the full pipeline (queued ->
  // processing -> stored -> completed) can be exercised end-to-end.
  async queue(batch: MessageBatch<ConversionQueueMessage>, rawEnv: Env): Promise<void> {
    const env = await withWasmModules(rawEnv)
    const jobService = createJobService(env)
    const conversionService = createConversionService(env)

    for (const message of batch.messages) {
      try {
        await conversionService.processJob(message.body.jobId)
        message.ack()
      } catch (error) {
        if (error instanceof ConflictError) {
          // Another delivery of this message is already handling the job (or
          // just finished) — see ConversionService.processJob. Safe to ack
          // without marking the job failed or retrying: retrying here would
          // just race the in-flight delivery again.
          console.warn(`Skipping duplicate delivery for job ${message.body.jobId}: ${error.message}`)
          message.ack()
          continue
        }
        const reason = error instanceof Error ? error.message : 'Unknown error'
        await jobService.markFailed(message.body.jobId, reason).catch((markFailedError: unknown) => {
          console.error(`Failed to mark job ${message.body.jobId} as failed:`, markFailedError)
        })
        message.retry()
      }
    }
  },
} satisfies ExportedHandler<Env, ConversionQueueMessage>
