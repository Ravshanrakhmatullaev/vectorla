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
  if (path.startsWith('/credits')) return handleCreditsRoute(request, env, requestId)
  if (path.startsWith('/history')) return handleHistoryRoute(request, env, requestId)
  return mapErrorToResponse(new NotFoundError(`No route for "${url.pathname}"`), requestId)
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
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
  async queue(batch: MessageBatch<ConversionQueueMessage>, env: Env): Promise<void> {
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
